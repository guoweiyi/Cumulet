# Cumulet

A private-cloud control plane for labs, campus teams, and small organizations.

[简体中文](./README.md) | **English**

Cumulet brings Proxmox VE, JumpServer, network policy, and resource approvals into one self-service portal. Users manage only their own servers and VPCs, while administrators retain control over approvals, infrastructure, audit, and deprovisioning.

## Core workflow

1. Users sign in with OIDC and bind an immutable real name and numeric student ID.
2. They create VPCs, submit resource requests, and follow ticket progress.
3. An administrator selects the PVE node, VMID, internal IP, and security group; the subnet is inferred from the IP.
4. A retryable pipeline runs Cloud-Init, security groups, external access, JumpServer, and notifications. Bastion assets are grouped under `/DEFAULT/共享区/{real name}`.
5. Users manage power, console, metrics, firewall, passwords, and resize requests.
6. CPU, memory, and disk changes require approval. Expired or released resources lose portal access immediately.

## Capabilities

- Proxmox VE 9.x status, power, Cloud-Init, Guest Agent, noVNC, and firewall APIs
- Bilingual dynamic forms, approval tickets, and step-based provisioning
- Per-user quotas, resize approvals, leases, and deprovisioning
- JumpServer asset and permission automation
- VPC, subnet, external-access, DNS, and webhook models
- PVE security groups, IPSets, aliases, baselines, and cross-zone sync
- OIDC user login; admin passwords, passkeys, and RBAC
- Runtime admin settings for OIDC, SMTP, JumpServer, AI, and quotas
- AI health inspections, audit logs, and Chinese/English UI

PVE is the complete provisioning path today. AWS, vCenter/ESXi, and FNOS have provider adapters and connection tests, but need environment-specific discovery and provider-neutral binding before production provisioning.

## Quick start

Node.js 20+ and MySQL 8 are required.

```bash
git clone https://github.com/<your-org>/cumulet.git
cd cumulet
npm install
cp .env.example .env

npx prisma migrate deploy
SEED_ADMIN_EMAIL=admin@example.com \
SEED_ADMIN_PASSWORD='<strong-password>' \
npm run db:seed

npm run dev
```

Open `http://localhost:3000`.

Keep only bootstrap configuration in `.env`:

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `APP_ENCRYPTION_KEY`
- scheduler and Docker startup options

Configure OIDC, PVE, JumpServer, SMTP, AI, quotas, and provisioning defaults in the admin console. Legacy `OIDC_*` variables are only a migration fallback and can be removed after saving OIDC settings once.

## First setup

1. Sign in at `/admin/login` with the seeded administrator.
2. Configure and test OIDC, SMTP, JumpServer, and AI under Settings.
3. Add and verify a PVE 9.x node.
4. Configure security groups, quotas, and a request form.
5. Publish the form and verify the first request end to end.

The OIDC provider must return:

```text
sub
email
email_verified = true
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server and noVNC WebSocket proxy |
| `npm run build` | Production build |
| `npm start` | Start production |
| `npm test` | Run Vitest |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Prisma Client |
| `npx prisma migrate deploy` | Apply production migrations |

## Security boundaries

- Every API reloads user roles and resource ownership on the server.
- Foreign and closed resources return 404 to ordinary users.
- OIDC email must be provider-verified. Bound real names and student IDs are immutable.
- PVE, JumpServer, OIDC, SMTP, and AI secrets are encrypted at rest and write-only in the UI.
- noVNC is proxied server-side; PVE tokens never reach the browser.
- Deprovisioning revokes portal access first and does not claim success when critical external revocation fails.

## Stack

Next.js 16, React 19, TypeScript, Prisma 6, MySQL 8, Auth.js v5, next-intl, and Tailwind CSS 4.

## License

[MIT](./LICENSE)
