# syntax=docker/dockerfile:1

# Cumulet runs a custom Node server (server.js: Next.js + the noVNC WebSocket
# proxy), so we ship the full runtime rather than Next's standalone output
# (standalone can't trace deps that only server.js uses, e.g. ws).

# ---- base: shared runtime prerequisites -------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# ---- builder: install once, generate Prisma, and build Next -----------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
COPY scripts/harden-next-postcss.mjs ./scripts/harden-next-postcss.mjs
RUN npm ci --no-audit --no-fund
COPY . .
# Build-only placeholders are scoped to this command and never persist in an
# image layer's environment. Real secrets are injected only at runtime.
RUN APP_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
    NEXTAUTH_SECRET=build-time-placeholder \
    npx prisma generate && npm run build

# Preserve the package directory names for platform-native dependencies that
# production pruning removes. This stage contains only the selected SWC package.
FROM builder AS native-deps
RUN mkdir -p /native-next /native-parcel /native-swc \
  && cp -a node_modules/@next/swc-* /native-next/ \
  && cp -a node_modules/@parcel/watcher-* /native-parcel/ \
  && cp -a node_modules/@swc/core-* /native-swc/

# Derive runtime modules from the already-built tree. This avoids keeping two
# independently installed node_modules trees in BuildKit at peak disk usage.
FROM builder AS prod-deps
RUN npm prune --omit=dev --omit=optional --no-audit --no-fund \
  && node scripts/harden-next-postcss.mjs \
  && npx prisma generate

# ---- runner: minimal runtime image ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=prod-deps /app/node_modules ./node_modules
# `tsx` is a runtime dependency because first-boot seeding executes seed.ts.
# npm prune --omit=optional removes its architecture-specific esbuild binary,
# so restore only that binary from the builder (works for amd64 and arm64).
COPY --from=builder /app/node_modules/@esbuild ./node_modules/@esbuild
# Next's custom server loads the platform SWC package at startup. Keep the
# builder-selected native package so a non-root runtime never tries to download
# a fallback into read-only node_modules.
COPY --from=native-deps /native-next ./node_modules/@next
# next-intl/plugin statically loads its optional extractor modules while the
# config is evaluated, so their platform bindings must also be present.
COPY --from=native-deps /native-parcel ./node_modules/@parcel
COPY --from=native-deps /native-swc ./node_modules/@swc
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY package.json next.config.mjs server.js docker-entrypoint.sh ./
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs \
  && chmod +x docker-entrypoint.sh \
  && mkdir -p /app/data \
  && chown -R nextjs:nodejs /app/.next /app/data

EXPOSE 3000
USER nextjs
ENTRYPOINT ["./docker-entrypoint.sh"]
