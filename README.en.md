# Cumulet

A self-service private-cloud portal for labs, campus teams, and small organizations — Proxmox VE, JumpServer, network policy, and resource approvals in one console.

[简体中文](./README.md) | **English**

## Core workflow

1. Users sign in with OIDC and submit a resource request.
2. An administrator approves it and picks the PVE node, VMID, internal IP, and security group.
3. A retryable pipeline runs Cloud-Init, security groups, JumpServer asset/account/permission automation, and notifications.
4. Users self-manage power, remote console, credentials, firewall, and resize requests.

## Quick start

Requires Node.js 20+ and MySQL 8.

```bash
git clone https://github.com/<your-org>/cumulet.git
cd cumulet
npm install
cp .env.example .env

npx prisma migrate deploy
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='<strong-password>' npm run db:seed

npm run dev
```

Open `http://localhost:3000`. The `.env` only needs startup-level values such as `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and `APP_ENCRYPTION_KEY`.

## First-time setup

1. Sign in with the seeded admin at `/admin/login`.
2. Configure and test OIDC, SMTP, JumpServer, and AI in Settings.
3. Add and validate a PVE 9.x node under AZ Nodes.
4. Configure security groups, quotas, the request form, and the provisioning workflow.
5. Publish the form, submit a first request, and verify the full pipeline.

The OIDC provider must return `sub`, `email`, and `email_verified = true`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (includes noVNC WebSocket proxy) |
| `npm run build` / `npm start` | Production build / start |
| `npm test` / `npm run lint` | Vitest / ESLint |
| `npx prisma migrate deploy` | Apply production migrations |

## Security highlights

- Every API re-checks role and resource ownership server-side; unauthorized or released resources return 404.
- PVE, JumpServer, SMTP, and AI secrets are encrypted at rest; the UI only shows "configured".
- noVNC is server-side proxied; PVE tokens never reach the browser. External permissions are revoked before deprovisioning.

## Tech stack

Next.js 16 · React 19 · TypeScript · Prisma 6 · MySQL 8 · Auth.js v5 · next-intl · Tailwind CSS 4

## License

[MIT](./LICENSE)
