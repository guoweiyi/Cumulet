# Contributing to Cumulet

Thanks for your interest in improving 栖云 · Cumulet! This document explains how to get set up and what we expect from contributions.

## Getting started

Requires **Node.js 20+** and **MySQL 8**.

```bash
npm install
cp .env.example .env
# generate NEXTAUTH_SECRET (openssl rand -base64 32) and APP_ENCRYPTION_KEY (openssl rand -hex 32)
npx prisma migrate dev
npm run db:seed
npm run dev
```

## Before you open a pull request

Please make sure all of the following pass:

```bash
npm run build        # production build must succeed
npm test             # vitest suite (includes the authorization tests)
npx tsc --noEmit     # no type errors
npm run lint
```

- **Keep PRs focused.** One logical change per PR is much easier to review.
- **Add tests** for new logic, especially anything touching authorization, quotas, the ticket state machine, or firewall validation. The authorization suite in `tests/authorization.test.ts` is our most important guard against regressions — extend it when you add routes.
- **Don't weaken the security model.** Every API route authorizes server-side via `src/lib/guards.ts` (or `vmContext`), returns `404` on foreign records, and validates all input. New routes must follow the same pattern.
- **Never commit secrets.** `.env` is gitignored; infrastructure credentials live in the encrypted `SystemSetting` store, not in code or env.

## Internationalization

Cumulet is bilingual (Simplified Chinese default, English secondary). If you add or change any user-facing string:

- Add it to **both** `src/messages/zh.json` and `src/messages/en.json`. `zh` is required; `en` should be provided.
- Never hardcode display strings in components — always go through `next-intl`.
- Bilingual database content (form labels/hints, group descriptions) uses `{ zh, en }` JSON, with `zh` required.

## Coding style

- TypeScript throughout; match the surrounding code's conventions.
- Server-side secrets and external API clients (`lib/pve.ts`, `lib/jumpserver.ts`) are `server-only` and must never be imported into client components.
- Comments should explain *why* a constraint exists, not narrate *what* the next line does.

## Reporting bugs & requesting features

Use the GitHub issue templates. For **security vulnerabilities, do not open a public issue** — see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
