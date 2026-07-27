<div align="center">

# 栖云 · Cumulet

**一朵栖息在几台机器上的小云。**

面向 [Proxmox VE](https://www.proxmox.com/) 的自助式云资源控制台 —— 一个安全、多租户、对接 SSO 的门户，真正可以放心交给你的成员使用。

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)
![Proxmox VE 9](https://img.shields.io/badge/Proxmox%20VE-9-e57000)

</div>

---

## 为什么需要栖云？

如果你在为实验室、学生社团或小团队维护一套 Proxmox 集群，下面这些痛点你大概都遇到过 —— 大致按刺痛程度排序：

1. **PVE 的 Web 界面太危险，不敢直接给成员用。** 它没有真正的多租户：给谁开一个账号，他就能看到、甚至操作所有人的虚拟机、集群防火墙和存储。「我们不能直接把 Proxmox 界面丢给学生」是所有人撞上的第一堵墙。栖云在 PVE 前面加了一层**按租户隔离的控制台** —— 每个用户只能看到自己的虚拟机，每一次操作都在服务端针对本人的资源做鉴权。

2. **开通资源全靠「私聊管理员」的手工流程。** 有人私信管理员，管理员手动建虚拟机、把 IP 抄回去、在某个地方设个密码…… 既没有记录，也无法复现。栖云把一次申请变成一张带对话式审批的**工单**，再由**分步骤、可追踪的自动化流水线**完成剩下的事：绑定虚拟机、执行 Cloud-Init、下发防火墙安全组、注册堡垒机资产、授予访问、邮件通知用户。每一步都是幂等的，可以单独重试。

3. **组织明明已经有 SSO，身份却四分五裂。** 你有 Casdoor / Keycloak / 某个 OIDC，但 Proxmox 和 JumpServer 各有各的登录，而且没有任何东西能把一台虚拟机追溯到某个真实的人。栖云让用户通过**你现有的 OIDC** 登录，管理员则可用密码 + **通行密钥（WebAuthn）** + OIDC 登录。

4. **缺少问责层。** 这台虚拟机归谁？谁批的？那条防火墙规则谁改的？这个人的真实姓名和配额是多少？栖云补上了**一次性实名登记、按用户配额，以及一份完整的审计日志** —— 记录每一次管理操作，以及每一次对 PVE / JumpServer / 防火墙的变更。

5. **SSH 访问难以安全地规模化。** 你可以架一台堡垒机，但把每台新虚拟机手工接进去 —— 建资产、匹配用户、授权限 —— 根本扩展不了。栖云自动驱动 **[JumpServer](https://www.jumpserver.org/)**：审批通过时自动创建资产，并按邮箱把访问权授予申请人，用户经堡垒机（网页终端或 SSH 客户端）连接，无需任何配置。

最终得到的，是公有云控制台那样的自助体验 —— 申请、审批、管理、连接 —— 而底座正是你手上那套 Proxmox 集群。

## 功能特性

- **按租户隔离的自助管理** —— 电源控制（开机 / 重启 / 关机 / 强制停止）、实时状态与监控（环形仪表 + 曲线图）、配额内在线调整配置、一次性密码重置，以及内嵌 **noVNC 控制台**。
- **动态申请表单** —— 管理员表单构建器（拖拽排序、条件显示、双语标签、版本化），直接渲染为用户申请页；提交内容在客户端与服务端双重校验。
- **对话式工单** —— 聊天式审批时间线、仅管理员可见的内部备注、服务端强制的状态机。
- **自动化开通流水线** —— 校验 → Cloud-Init → PVE 安全组 → 堡垒机资产 → 堡垒机授权 → 通知，逐步骤追踪，支持重试 / 跳过。
- **云风格防火墙** —— 以 PVE 为准的安全组；用户自助管理自己虚拟机的规则（含常用预设与 CIDR / 端口校验）；管理员下发的基线规则被锁定，并在被篡改时自动重新下发；管理员可管理数据中心级安全组、IPSet 与别名。
- **跨区防火墙复制** —— 可从源可用区向多个目标区复制单个安全组，或同步全部安全组、IPSet 与别名；合并模式保留目标区独有对象，确认后的镜像模式会恢复规则顺序并清除漂移。
- **供应商无关的资源生命周期** —— 类型安全的虚拟化插件接口、审批时事务化校验 CPU/内存/磁盘配额、租期到期与供应商关机。
- **租户网络与外部访问** —— 隔离网络/子网、确定性的 FRP 配置、分离 DNS，以及可持久重试的签名 Webhook。
- **用户与配额管理** —— 管理员可新增、查看、编辑、删除普通用户并调整配额；角色授予与管理员凭据仅限 SUPER_ADMIN，实名保持不可变，并保护最后一个超级管理员。
- **AI 巡检** —— 在系统设置中配置 DeepSeek 或其他 OpenAI 兼容服务；用户可对自己的 VM 发起诊断，后台按最久未巡检优先策略定时巡检，并可自动建立仅管理员可见的告警工单。
- **堡垒机集成** —— JumpServer v3/v4，支持 Private Token 或 AccessKey（HTTP-Signature）认证；资产与授权的自动化生命周期，含资源回收。
- **双语** —— 默认简体中文，完整支持英文，可在顶栏切换（界面、动态表单标签、邮件、日期一并切换）。
- **默认安全** —— 每个接口都做服务端 RBAC，密钥 AES-256-GCM 静态加密，noVNC 代理加密，接口限流，并附有一份完整的[安全审计报告](./SECURITY_AUDIT.md)。

## 技术栈

- **Next.js**（App Router，v16）+ React 19 + TypeScript
- **Tailwind CSS v4** + shadcn/ui
- **next-intl**（默认 zh / en），基于 Cookie，无 URL 语言前缀
- **MySQL 8** + **Prisma 6**（锁定 —— Prisma 7 已将数据源 `url` 移出 schema）
- **Auth.js (NextAuth v5)** —— 成员用 OIDC；管理员用邮箱密码 + 通行密钥（WebAuthn）+ OIDC
- **Nodemailer**（SMTP 配置在发送时从数据库读取）
- **Proxmox VE 9** REST + **JumpServer v3/v4** REST，均通过服务端 `undici` fetch
- **OpenAI SDK** 对接兼容模型，**node-cron** 执行自托管定时巡检
- 有意保持单体：无消息队列、无 Redis。实时状态用轮询；自定义服务器同时承载 noVNC 代理与巡检调度。

## 快速开始

需要 **Node.js 20+** 与 **MySQL 8**。

```bash
git clone https://github.com/<your-org>/cumulet.git
cd cumulet
npm install
cp .env.example .env          # 然后按下面填好

# 生成密钥：
#   NEXTAUTH_SECRET    → openssl rand -base64 32
#   APP_ENCRYPTION_KEY → openssl rand -hex 32   （64 位十六进制 = 32 字节）

npx prisma migrate deploy
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='<私有强密码>' npm run db:seed
npm run dev                   # http://localhost:3000  （自定义服务器：Next.js + noVNC 代理）
```

`.env` 只保存启动所需配置（数据库、Auth.js、OIDC、加密密钥、默认语言）。**PVE 节点、JumpServer、SMTP、默认配额与开通默认值都在运行时于管理后台配置**，并加密存入数据库 —— 仓库和环境变量里不含任何基础设施密钥。

OIDC 服务必须返回邮箱及标准布尔声明 `email_verified: true`。邮箱会用于关联本地账号与 JumpServer 权限，因此栖云会拒绝未经验证的邮箱身份。

## 首次运行

1. 用种子生成的 SUPER_ADMIN 登录 `/admin/login`，注册通行密钥并修改密码（`/admin/profile`）。
2. **系统设置**（`/admin/settings`）：配置 SMTP、JumpServer、AI 服务与巡检计划，以及开通默认值（默认安全组、用于基线 SSH 放行的堡垒机内网 IP、门户地址）。
3. **可用区节点**（`/admin/nodes`）：添加 PVE 节点并「测试连接」—— 节点须验证通过后方可用于开通。
4. **安全组**（`/admin/security-groups`）：创建安全组；将其一设为开通默认，将需要开放给用户的设为 `SHARED`。
5. **表单管理**（`/admin/forms`）：构建并发布成员将看到的资源申请表单。
6. **用户管理**（`/admin/users`）：维护用户资料和配额；角色授予与管理员密码仅限 SUPER_ADMIN。
7. 成员在 `/` 通过 OIDC 登录，完成一次性实名登记后提交申请。管理员在 `/admin/tickets/[id]` → **批准并开通**。

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 自定义服务器（Next.js + noVNC WebSocket 代理），开发模式 |
| `npm run build` | 生产构建 |
| `npm start` | 生产自定义服务器 |
| `npm test` | Vitest 测试（加解密、表单、状态机、防火墙、脱敏、**鉴权**） |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | 生成 SUPER_ADMIN + 默认配额 |

## 架构要点

- **每个接口处理函数都做基于数据库的鉴权**（`src/lib/guards.ts`），而不仅依赖中间件。越权访问他人资源返回 `404`（不泄露存在性）；AUDITOR 只读；设置与角色授予仅限 SUPER_ADMIN。
- **密钥**（PVE Token、JumpServer 密钥、SMTP 密码、一次性凭据）经 `APP_ENCRYPTION_KEY` 做 AES-256-GCM 静态加密，界面上只写不读。
- **开通流水线**（`src/lib/pipeline.ts`）：六个幂等、可单独重试的步骤。防火墙规则以 PVE 为准；管理员基线规则在被篡改时自动重新下发。
- **noVNC**：浏览器连接自定义服务器（`server.js`）的 `/vncws`，由其代理到 PVE 的 `vncwebsocket`，API Token 在服务端附加 —— 凭据永不到达客户端。
- **API 与扩展**：供应商插件位于 `src/lib/providers`；OpenAPI JSON 在 `/api/openapi`，Swagger UI 在 `/api-docs`。完整说明见[文档索引](./docs/README.md)。

## 使用 Docker 部署

仓库内提供多阶段 `Dockerfile` 和包含 MySQL 8.4 的 `docker-compose.yml`。应用容器以非 root 用户运行，启动时自动执行生产迁移，并通过 `/api/health` 同时检查应用与数据库。

```bash
cp .env.example .env
# 至少填写 MYSQL_ROOT_PASSWORD、MYSQL_PASSWORD、NEXTAUTH_SECRET、
# APP_ENCRYPTION_KEY，以及首次初始化管理员所需的两个 SEED_* 变量。
# SEED_ADMIN_PASSWORD 至少 12 位，并同时包含字母和数字。

# 第一次启动：构建镜像、迁移数据库并幂等写入管理员与默认表单
SEED_ON_START=true docker compose up -d --build

# 后续启动：仍会自动应用尚未执行的迁移，但不重复播种
docker compose up -d
```

访问地址为 `http://localhost:${APP_PORT:-3000}`。首次启动确认完成后，请将 `SEED_ON_START` 改回 `false`。如果 MySQL 密码包含 `@`、`:` 等 URL 保留字符，请填写经过百分号编码的 `DOCKER_DATABASE_URL`。反向代理部署时，应将 `NEXTAUTH_URL` 设置为公开的 `https://` 源站，并转发 `X-Forwarded-For`、`Origin` 与 `Sec-Fetch-Site`。

## 常见问题

**`prisma migrate` 报错 `Unknown authentication plugin 'sha256_password'`。**
Prisma 引擎支持 `mysql_native_password` 与 `caching_sha2_password` 两种 MySQL 认证插件，但**不支持** `sha256_password`。部分托管 / 测试型 MySQL 会把用户配置为 `sha256_password`。请将该用户切换到受支持的插件（在被允许连接的主机上、用任何支持 `sha256_password` 的客户端执行 —— `mysql` 命令行，或 TablePlus / DBeaver / Navicat 等图形客户端）：

```sql
ALTER USER USER() IDENTIFIED WITH caching_sha2_password BY '<你的密码>';
```

`USER()` 指向你自己的账号，因此无需管理员权限。若无法修改插件（受限的托管数据库），请改用其用户为 `caching_sha2_password`（MySQL 8 默认）或 `mysql_native_password` 的数据库。

**`npm install` 报 `ERESOLVE`。** 仓库内的 `.npmrc` 已设置 `legacy-peer-deps=true`，用于协调 `next-auth@beta` 一个可选且未使用的 `nodemailer` peer 依赖，正常情况下安装是干净的。若你删掉了它，请重新加上，或用 `--legacy-peer-deps` 安装。

## 范围

栖云有意**不做**：计费、虚拟机模板 / 克隆编排（管理员绑定已存在的 vmid，由 Cloud-Init 初始化）、应用内 SSH 中继（交互式会话交给 JumpServer 自带网页终端）、宿主机级防火墙管理、对象存储。完整的非目标清单见设计说明。

## 参与贡献

欢迎贡献 —— 请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与[行为准则](./CODE_OF_CONDUCT.md)。提交 PR 前请先跑 `npm test` 与 `npm run build`。

## 安全

请私下报告安全漏洞 —— 见 [SECURITY.md](./SECURITY.md)。第 8 阶段的审计报告、发现与修复，以及部署加固清单见 [SECURITY_AUDIT.md](./SECURITY_AUDIT.md)。

## 许可证

[MIT](./LICENSE) © Cumulet Contributors
