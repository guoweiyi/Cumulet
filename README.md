# 栖云 Cumulet

面向实验室、校园团队和小型组织的私有云控制面板。

**简体中文** | [English](./README.en.md)

Cumulet 将 Proxmox VE、JumpServer、网络策略和资源审批收敛到一个自助门户，统一完成审批与运维操作。

## 能力

- PVE 9.x 虚拟机状态、电源、Cloud-Init、Guest Agent、noVNC 与防火墙
- 动态双语申请表、工单审批和逐步骤开通流水线
- 用户级配额、配置调整审批、租期和资源回收
- JumpServer 资产与授权自动化
- VPC、子网、外网入口、DNS 与 Webhook 数据模型
- PVE 安全组、IPSet、别名、基线规则及跨可用区同步
- OIDC 用户登录；管理员密码、Passkey 和 RBAC
- SMTP、OIDC、JumpServer、AI、配额等后台运行时配置
- AI 健康巡检、审计日志和中英文界面

PVE 是当前完整开通路径。AWS、vCenter/ESXi 和 FNOS 已有供应商适配器与连接测试，但仍需按实际环境补齐资源发现和通用绑定流程后再用于生产开通。

## 快速开始

需要 Node.js 20+ 和 MySQL 8。

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

访问 `http://localhost:3000`。

`.env` 只保留启动级配置：

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `APP_ENCRYPTION_KEY`
- 调度器与 Docker 启动参数

## 首次配置

1. 使用种子管理员登录 `/admin/login`。
2. 在“系统设置”配置并测试 OIDC、SMTP、JumpServer 和 AI。
3. 在“可用区节点”添加并验证 PVE 9.x 节点。
4. 配置安全组、用户配额和资源申请表。
5. 发布表单后，从用户门户提交第一张申请并验证完整流水线。

OIDC Provider 必须返回：

```text
sub
email
email_verified = true
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发服务器与 noVNC WebSocket 代理 |
| `npm run build` | 生产构建 |
| `npm start` | 启动生产服务 |
| `npm test` | 运行 Vitest |
| `npm run lint` | ESLint |
| `npm run db:generate` | 生成 Prisma Client |
| `npx prisma migrate deploy` | 应用生产迁移 |

## 安全边界

- 每个 API 在服务端重新读取用户、角色和资源所有权。
- 普通用户访问他人资源以及已关闭资源时返回 404。
- OIDC 邮箱必须经过 Provider 验证；真实姓名和学号绑定后不可修改。
- PVE、JumpServer、OIDC、SMTP 与 AI 密钥加密存储，前端只显示“已配置”。
- noVNC 连接由服务端代理，PVE Token 不进入浏览器。
- 释放资源时先撤销平台管理权限；关键外部撤权失败不会虚假标记完成。

## 技术栈

Next.js 16、React 19、TypeScript、Prisma 6、MySQL 8、Auth.js v5、next-intl、Tailwind CSS 4。

## 许可证

[MIT](./LICENSE)
