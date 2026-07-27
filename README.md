<div align="center">

# 栖云 · Cumulet

**A little cloud, perched on a few machines.**

Self-service cloud console for [Proxmox VE](https://www.proxmox.com/) — the safe, multi-tenant, SSO-backed portal you can actually hand to your members.

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![Proxmox VE 9](https://img.shields.io/badge/Proxmox%20VE-9-e57000)

</div>

---

## Why Cumulet?

If you run a Proxmox cluster for a lab, a student club, or a small team, you have probably hit these — roughly in this order of pain:

1. **The PVE web UI is too dangerous to hand to members.** There is no real multi-tenancy: give someone an account and they can see, and touch, everyone else's VMs, the cluster firewall, the storage. "We can't just give students the Proxmox UI" is the wall everyone hits first. Cumulet puts a **tenant-scoped console** in front of PVE — every user sees only their own VMs, and every action is authorized server-side against their own resources.

2. **Provisioning is a manual, chat-message workflow.** Someone DMs an admin, the admin hand-creates a VM, copies an IP back, sets a password somewhere… and it's undocumented and unrepeatable. Cumulet turns a request into a **ticket** with a conversational approval thread, then an **automated, step-tracked pipeline** does the rest: bind the VM, run Cloud-Init, apply a firewall group, register the bastion asset, grant access, email the user. Each step is idempotent and individually retryable.

3. **Identity is fragmented even though the org already has SSO.** You've got Casdoor / Keycloak / some OIDC provider, but Proxmox and JumpServer each have their own logins, and nothing ties a VM back to a real person. Cumulet authenticates users through **your existing OIDC**, and admins via password + **passkey (WebAuthn)** + OIDC.

4. **There's no accountability layer.** Who owns this VM? Who approved it? Who changed that firewall rule? What's this person's real name and quota? Cumulet adds **one-time real-name onboarding, per-user quotas, and a full audit log** of every admin action and every PVE / JumpServer / firewall mutation.

5. **SSH access doesn't scale safely.** You can stand up a bastion, but wiring each new VM into it by hand — creating the asset, matching the user, granting the permission — doesn't scale. Cumulet drives **[JumpServer](https://www.jumpserver.org/)** automatically: on approval it creates the asset and grants the requester access matched by email, so people connect through the bastion (web terminal or SSH) with nothing to configure.

The result is the self-service experience of a public cloud console — request, approve, manage, connect — on top of the Proxmox cluster you already run.

## Features

- **Tenant-scoped self-service** — power (start / reboot / shutdown / force-stop), live status & monitoring (ring gauges + charts), resize within quota, one-time password reset, and an embedded **noVNC console**.
- **Dynamic request forms** — an admin form builder (drag-to-reorder blocks, conditional logic, bilingual labels, versioned) rendered as the user request page; submissions validated on both client and server.
- **Conversational ticketing** — chat-style approval timeline, admin-only internal notes, a server-enforced state machine.
- **Automated provisioning pipeline** — validate → Cloud-Init → PVE security group → JumpServer asset → JumpServer permission → notify, with a per-step tracker and retry / skip.
- **Cloud-style firewall** — PVE-backed security groups; users manage their own VM rules with presets and CIDR/port validation; admin baseline rules are locked and re-asserted on drift; datacenter security groups, IPSets and aliases for admins.
- **Cross-zone firewall replication** — copy one group or reconcile all groups, IPSets and aliases from a source AZ to selected targets; merge preserves target-only objects, while confirmed mirror mode restores source ordering and removes drift.
- **Provider-neutral lifecycle** — a typed hypervisor plugin contract, transactional CPU/RAM/disk quota checks, expiring leases, and provider-driven shutdown.
- **Tenant networking & external access** — isolated networks/subnets, deterministic FRP rules, split DNS, and durable signed webhooks.
- **User lifecycle & quotas** — admins can create and maintain ordinary users and quotas; SUPER_ADMIN controls role grants and admin credentials, with immutable real names and last-super-admin protection.
- **AIOps inspections** — configure DeepSeek or another OpenAI-compatible provider in Settings, run tenant-scoped VM diagnostics on demand, and schedule fair, lease-protected inspections that can open internal alert tickets.
- **Bastion integration** — JumpServer v3/v4, Private-Token or AccessKey (HTTP-Signature) auth; automated asset + permission lifecycle including de-provisioning.
- **Bilingual** — Simplified Chinese by default, full English support, switchable in the top nav (UI, dynamic form labels, emails, dates).
- **Secure by construction** — DB-backed RBAC on every route, AES-256-GCM secrets at rest, encrypted noVNC proxy, rate limiting, and a documented [security audit](./SECURITY_AUDIT.md).

## Tech stack

- **Next.js** (App Router, v16) + React 19 + TypeScript
- **Tailwind CSS v4** + shadcn/ui
- **next-intl** (zh default / en), cookie-based, no URL locale prefixes
- **MySQL 8** + **Prisma 6** (pinned — Prisma 7 moved the datasource `url` out of the schema)
- **Auth.js (NextAuth v5)** — OIDC for members; email/password + passkey (WebAuthn) + OIDC for admins
- **Nodemailer** (SMTP config loaded from the DB at send time)
- **Proxmox VE 9** REST + **JumpServer v3/v4** REST via server-side `undici` fetch
- **OpenAI SDK** for compatible AIOps providers + **node-cron** for self-hosted scheduled inspections
- Monolith by design: no queues, no Redis. Polling for live state; a single custom server for noVNC and the scheduler.

## Quick start

Requires **Node.js 20+** and **MySQL 8**.

```bash
git clone https://github.com/<your-org>/cumulet.git
cd cumulet
npm install
cp .env.example .env          # then fill in the values below

# Generate secrets:
#   NEXTAUTH_SECRET    → openssl rand -base64 32
#   APP_ENCRYPTION_KEY → openssl rand -hex 32   (64 hex chars = 32 bytes)

npx prisma migrate deploy
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='<strong-private-password>' npm run db:seed
npm run dev                   # http://localhost:3000  (custom server: Next.js + noVNC proxy)
```

`.env` holds only bootstrap config (database, Auth.js, OIDC, encryption key, default locale). **PVE nodes, JumpServer, SMTP, default quotas, and provisioning defaults are configured at runtime** in the admin Settings pages and stored encrypted in the database — no infrastructure secrets in your repo or environment.

The OIDC provider must return an email and the standard boolean `email_verified: true` claim. Cumulet rejects unverified email identities because email links local accounts and JumpServer permissions.

## First run

1. Sign in at `/admin/login` with the seeded SUPER_ADMIN, register a passkey and change the password (`/admin/profile`).
2. **Settings** (`/admin/settings`): SMTP, JumpServer, AIOps provider/schedule, and provisioning defaults (default security group, JumpServer internal IP for the baseline SSH rule, portal URL).
3. **AZ Nodes** (`/admin/nodes`): add your PVE nodes and run **Test Connection** — a node must be verified before it can back a provisioning.
4. **Security Groups** (`/admin/security-groups`): create groups; mark one as the provisioning default and any as `SHARED` to expose them to users.
5. **Forms** (`/admin/forms`): build and publish the resource-request form your members will see.
6. **Users** (`/admin/users`): maintain user profiles and quotas; role grants and administrator passwords remain SUPER_ADMIN-only.
7. Members sign in at `/` via OIDC, complete one-time real-name onboarding, and submit requests. Approve them from `/admin/tickets/[id]` → **Approve & Provision**.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Custom server (Next.js + noVNC WebSocket proxy), dev |
| `npm run build` | Production build |
| `npm start` | Production custom server |
| `npm test` | Vitest suite (crypto, forms, state machine, firewall, masking, **authorization**) |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Seed a SUPER_ADMIN + default quota |

## Architecture notes

- **Authorization is DB-backed in every route handler** (`src/lib/guards.ts`), not just middleware. Foreign records return `404` (no existence oracle); AUDITOR is read-only; settings and role grants are SUPER_ADMIN-only.
- **Secrets** (PVE tokens, JumpServer keys, SMTP password, one-time credentials) are AES-256-GCM encrypted at rest via `APP_ENCRYPTION_KEY` and are write-only in the UI.
- **Provisioning pipeline** (`src/lib/pipeline.ts`): six idempotent, individually retryable steps. PVE stays the source of truth for firewall rules; admin baseline rules are re-asserted on drift.
- **noVNC**: the browser connects to `/vncws` on the custom server (`server.js`), which proxies to PVE's `vncwebsocket` with the API token attached server-side — credentials never reach the client.
- **API and extensions**: provider plugins live under `src/lib/providers`; OpenAPI JSON is served at `/api/openapi` and Swagger UI at `/api-docs`. See the [documentation index](./docs/README.md).

## Deploy with Docker

The repo ships a multi-stage `Dockerfile` (running the custom `server.js` — Next.js + the noVNC proxy) and a `docker-compose.yml` with MySQL 8.4.

```bash
cp .env.example .env
# set at least NEXTAUTH_SECRET and APP_ENCRYPTION_KEY:
#   openssl rand -base64 32   # NEXTAUTH_SECRET
#   openssl rand -hex 32      # APP_ENCRYPTION_KEY (64 hex chars)
# and set MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD to strong random values.
# Set SEED_ADMIN_EMAIL and a private SEED_ADMIN_PASSWORD (12+ characters,
# containing letters and numbers) before enabling first-boot seeding.

# First boot: build, start, and seed the SUPER_ADMIN + default form
SEED_ON_START=true docker compose up -d --build

# Subsequent runs (migrations are applied automatically on start)
docker compose up -d
```

The app is at `http://localhost:${APP_PORT:-3000}`. The non-root app container runs `prisma migrate deploy` on startup, exposes a database-aware `/api/health` check, and stops on initialization failure instead of serving a partially migrated schema. If the MySQL password contains URL-reserved characters, set `DOCKER_DATABASE_URL` to a percent-encoded Prisma URL. MySQL 8.4's default `caching_sha2_password` is Prisma-compatible, so there's no `sha256_password` pitfall inside the stack. Behind a reverse proxy, set `NEXTAUTH_URL` to the public `https://` origin and forward `X-Forwarded-For` / `Origin` / `Sec-Fetch-Site`.

## Troubleshooting

**`prisma migrate` fails with `Unknown authentication plugin 'sha256_password'`.**
Prisma's engine supports the `mysql_native_password` and `caching_sha2_password` MySQL auth plugins, but **not** `sha256_password`. Some managed/test MySQL instances configure users with `sha256_password`. Switch the user to a supported plugin (run from a host allowed to connect, using any client that speaks `sha256_password` — the `mysql` CLI, or a GUI such as TablePlus/DBeaver/Navicat):

```sql
ALTER USER USER() IDENTIFIED WITH caching_sha2_password BY '<your-password>';
```

`USER()` targets your own account, so this needs no admin privileges. If you cannot change the plugin (locked-down managed DB), use a MySQL whose user is on `caching_sha2_password` (the MySQL 8 default) or `mysql_native_password`.

**`npm install` reports `ERESOLVE`.** A committed `.npmrc` sets `legacy-peer-deps=true` to reconcile an optional, unused `nodemailer` peer of `next-auth@beta`; installs should be clean. If you removed it, re-add it or install with `--legacy-peer-deps`.

## Scope

Cumulet deliberately **does not** do billing, VM template/clone orchestration (admins bind existing vmids; Cloud-Init initializes them), an in-app SSH relay (JumpServer's own web terminal handles interactive sessions), host-level firewall management, or object storage. See the design notes for the full non-goals list.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and our [Code of Conduct](./CODE_OF_CONDUCT.md). Please run `npm test` and `npm run build` before opening a PR.

## Security

Please report vulnerabilities privately — see [SECURITY.md](./SECURITY.md). The Phase-8 audit report, findings/fixes, and a deployment hardening checklist are in [SECURITY_AUDIT.md](./SECURITY_AUDIT.md).

## License

[MIT](./LICENSE) © Cumulet Contributors
