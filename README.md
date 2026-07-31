# 栖云 Cumulet

> 轻量、敏捷的私有云自助资源发放与管理门户。

✅ **精准定位**：专为 HomeLab、校园工作室及小型组织打造。
✅ **多源接入**：无缝对接 Proxmox VE (PVE)、VMware ESXi 与 JumpServer。
✅ **流程定义**：支持高度自定义的资源申请审批流与自动化开通流水线。

**简体中文** | [English](./README.en.md)

## 核心工作流
1. **自助申请**：用户通过 OIDC 单点登录，提交虚拟机等资源的使用申请。
2. **工单审批**：管理员进行审批，并分配计算节点 (PVE/ESXi)、VMID、内网 IP 及网络安全组。
3. **自动交付**：开通流水线自动执行 Cloud-Init 初始化，配置网络策略，并完成 JumpServer 资产纳管、账号授权及结果通知。
4. **全生命周期管理**：用户在控制台自助完成电源管理、Web 终端访问、凭据查看及配置变更。

## 快速开始

需要 Node.js 20+ 与 MySQL 8。

```bash
git clone https://github.com/<your-org>/cumulet.git
cd cumulet
npm install
cp .env.example .env

npx prisma migrate deploy
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='<strong-password>' npm run db:seed

npm run dev
```

OIDC Provider 必须返回 `sub`、`email` 且 `email_verified = true`

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发服务器（含 noVNC WebSocket 代理） |
| `npm run build` / `npm start` | 生产构建 / 启动 |
| `npm test` / `npm run lint` | Vitest 测试 / ESLint |
| `npx prisma migrate deploy` | 应用生产迁移 |

## 技术栈

Next.js 16 · React 19 · TypeScript · Prisma 6 · MySQL 8 · Auth.js v5 · next-intl · Tailwind CSS 4

## 许可证

[MIT](./LICENSE)
