# 栖云 Cumulet

> 轻量、敏捷的私有云自助资源发放与管理门户。

✅ 专为 HomeLab、校园工作室及小型组织打造

✅ 对接 Proxmox VE (PVE)、VMware ESXi 与 JumpServer（欢迎二开继续丰富支持应用）

✅ 支持高度自定义的资源申请审批流与自动化开通流水线

✅ 接入 AI 能力，完成自动化巡检、问题处理

## 核心工作流

1. **自助申请**：用户登录（可接入单点登录），提交虚拟机等资源的使用申请。
2. **工单审批**：管理员进行审批，并分配计算节点 (PVE/ESXi)、VMID、内网 IP 及网络安全组。
3. **自动交付**：开通流水线自动执行 Cloud-Init 初始化，配置网络策略，并完成 JumpServer 资产纳管、账号授权及结果通知。
4. **全生命周期管理**：用户在控制台自助完成电源管理、Web 终端访问、凭据查看及配置变更。

## Docker 部署

生产环境推荐使用 Docker 部署，部署文件位于 [`deploy/`](./deploy/README.md)，支持两种形式：

- **Docker 数据库一键部署**（`deploy/docker-compose.yml`）：自动拉起 MySQL 8 + 应用，适合全新环境；
- **已有数据库部署**（`deploy/docker-compose.external-db.yml`）：接入已有的 MySQL 8 实例。

```bash
cd deploy
cp .env.example .env
# 编辑 .env：NEXTAUTH_SECRET / APP_ENCRYPTION_KEY / MySQL 或 EXTERNAL_DATABASE_URL
docker compose up -d          # 一键运行
# docker compose -f docker-compose.external-db.yml up -d   # 外部数据库
```

详细步骤、初始化管理员、升级与常见问题见 [deploy/README.md](./deploy/README.md)。

## 技术栈

Next.js 16 · React 19 · TypeScript · Prisma 6 · MySQL 8 · Auth.js v5 · next-intl · Tailwind CSS 4

## 开发指南

需要 Node.js 20+ 与 MySQL 8。

```bash
git clone https://github.com/guoweiyi/cumulet.git
cd cumulet
npm install
cp .env.example .env

npx prisma migrate deploy
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='<strong-password>' npm run db:seed

npm run dev
```

### 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发服务器（含 noVNC WebSocket 代理） |
| `npm run build` / `npm start` | 生产构建 / 启动 |
| `npm test` / `npm run lint` | Vitest 测试 / ESLint |
| `npx prisma migrate deploy` | 应用生产迁移 |

## 许可证

[MIT](./LICENSE)
