# 部署指南

| 形式 | 文件 | 适用场景 |
|---|---|---|
| **A. Docker 数据库一键部署** | `docker-compose.yml` | 全新环境，Compose 自动拉起 MySQL 8 + 应用，开箱即用 |
| **B. 已有数据库部署** | `docker-compose.external-db.yml` | 已存在 MySQL 8 实例（自建、云数据库 RDS 等），只部署应用 |

## 前置要求

- Docker Engine 20.10+（含 Docker Compose v2，`docker compose version` 可验证）
- 服务器可访问镜像仓库（Docker Hub 或你配置的私有仓库）
- **形式 A**：无需预装数据库
- **形式 B**：需要 MySQL 8，且已创建好数据库（字符集建议 `utf8mb4`）

## 步骤

```bash
cd deploy
cp .env.example .env
```

然后编辑 `.env`，必填项：

- `NEXTAUTH_SECRET`：`openssl rand -base64 32` 生成
- `APP_ENCRYPTION_KEY`：`openssl rand -hex 32` 生成（64 个十六进制字符）
- `NEXTAUTH_URL`：应用的对外访问地址

首次启动如需初始化管理员，设置 `SEED_ON_START=true`、`SEED_ADMIN_EMAIL`、`SEED_ADMIN_PASSWORD`（12 位以上且含字母和数字）。初始化完成后请把 `SEED_ON_START` 改回 `false` 并重新 `docker compose up -d`。

## 形式 A：Docker 数据库一键部署

Compose 会同时启动 MySQL 8 与应用，数据保存在命名卷 `db_data` 中，应用容器会等待数据库健康后再启动。

1. 配置 `.env` 中 MySQL 相关变量：

   ```bash
   MYSQL_ROOT_PASSWORD="<强密码>"
   MYSQL_DATABASE="cumulet"
   MYSQL_USER="cumulet"
   MYSQL_PASSWORD="<应用账号密码>"
   ```

2. 启动：

   ```bash
   docker compose up -d
   docker compose ps          # 等待 app 变为 healthy
   docker compose logs -f app # 查看首次迁移/初始化日志
   ```

3. 访问 `http://<服务器IP>:3000`。

常用运维命令：

```bash
docker compose down          # 停止（保留数据卷）
docker compose down -v       # 停止并删除数据库数据（不可恢复！）
docker compose pull && docker compose up -d   # 升级到最新镜像
docker compose exec db mysql -uroot -p        # 进入数据库
```

## 形式 B：已有数据库部署

只部署应用容器，应用启动时会自动执行 `prisma migrate deploy` 并完成表结构迁移。

1. 确认外部数据库为 MySQL 8，且账号有建表/读写权限。
2. 在 `.env` 中配置：

   ```bash
   EXTERNAL_DATABASE_URL="mysql://cumulet:密码@数据库主机:3306/cumulet"
   ```

   > 数据库在宿主机上时，地址中的主机名写 `host.docker.internal`（Linux 下需加
   > `extra_hosts: - "host.docker.internal:host-gateway"`）。密码含 `@`/`:` 等特殊字符时，
   > 需要对 URL 编码，或使用 `mysql://` URL 编码形式。

3. 启动：

   ```bash
   docker compose -f docker-compose.external-db.yml up -d
   docker compose -f docker-compose.external-db.yml logs -f app
   ```

4. 访问 `http://<服务器IP>:3000`。

升级镜像：

```bash
docker compose -f docker-compose.external-db.yml pull
docker compose -f docker-compose.external-db.yml up -d
```

## 构建与发布镜像

```bash
docker login
./scripts/build-and-push.sh
IMAGE=myregistry/cumulet VERSION=0.3.0 ./scripts/build-and-push.sh
PLATFORMS="linux/amd64" ./scripts/build-and-push.sh   # 只构建 x86
```
