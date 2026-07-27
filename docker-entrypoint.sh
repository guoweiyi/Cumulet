#!/bin/sh
set -eu

# Apply pending migrations before starting. Retry briefly in case the database
# is still coming up (compose healthcheck usually gates this already).
echo "[entrypoint] applying database migrations..."
tries=0
until ./node_modules/.bin/prisma migrate deploy; do
  tries=$((tries + 1))
  if [ "$tries" -ge 15 ]; then
    echo "[entrypoint] database not reachable after $tries attempts, giving up." >&2
    exit 1
  fi
  echo "[entrypoint] database not ready yet, retrying in 4s ($tries/15)..."
  sleep 4
done

# Optionally seed a SUPER_ADMIN + the default form on first boot.
if [ "${SEED_ON_START:-false}" = "true" ]; then
  if [ -z "${SEED_ADMIN_EMAIL:-}" ] || [ -z "${SEED_ADMIN_PASSWORD:-}" ]; then
    echo "[entrypoint] SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required when SEED_ON_START=true." >&2
    exit 1
  fi
  echo "[entrypoint] seeding (idempotent)..."
  ./node_modules/.bin/tsx prisma/seed.ts
fi

echo "[entrypoint] starting Cumulet..."
exec node server.js
