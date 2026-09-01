# 环境自检手册

本手册用于每次本地开发前、发布前和生产服务器巡检。统一脚本是
`scripts/environment-check.sh`，每项检查都会输出 `PASS`、`FAIL` 或 `SKIP`，
最后给出完整汇总。只要出现一项 `FAIL`，脚本退出码就是 `1`，
因此可以直接接入 CI、cron 或 systemd timer。

脚本不会打印 `.env` 中的值。常规自检不会自动重启、停止或删除
Docker 容器；一键恢复模式会执行 `docker compose up`，但不会删除容器或
数据卷。本地完整自检会临时启动已构建的 Web/API，探活后立即清理。

## 命令速查

| 场景      | 命令                                         | 使用时机               |
| ------- | ------------------------------------------ | ------------------ |
| 开发环境一键恢复 | `pnpm dev:resume`                         | 重启电脑并启动 Docker Desktop 后 |
| 本地完整自检  | `pnpm check:env`                           | 提交前；先停止 `pnpm dev` |
| 本地运行态自检 | `pnpm check:env:runtime`                   | `pnpm dev` 正在运行时   |
| 生产服务器自检 | `bash scripts/environment-check.sh server` | Ubuntu Linux 虚拟机内  |

## 结果含义

- `PASS`：本项已实际执行且符合预期。
- `FAIL`：本项已执行但不符合预期；整体退出码为 `1`。
- `SKIP`：前置条件不成立或主动选择轻量模式；原因会跟在该项后面。

验收标准是汇总中 `FAIL=0`。完整模式不应出现 `SKIP`；运行态
模式会因为不执行质量门禁而出现一项预期中的 `SKIP`。

## 本地环境

### 重启后一键恢复

完成首次准备后，电脑重启不需要重新安装依赖或创建 `.env`。先启动
Docker Desktop，再在仓库根目录执行：

```bash
pnpm dev:resume
```

该模式会自动：

1. 将本机 Volta 工具链加入脚本的 `PATH`。
2. 启动 PostgreSQL 和 MinIO，最多等待 90 秒直到容器健康。
3. 执行可重复的本地数据库迁移，不执行 seed。
4. 执行完整本地自检。
5. 仅在汇总为 `FAIL=0 SKIP=0` 时启动 `pnpm dev`。

命令会继续占用当前终端以显示 Web/API 日志。按 `Ctrl+C` 停止
Web/API；PostgreSQL 和 MinIO 会继续运行，便于下次开发。

### 首次准备

在仓库根目录执行：

```bash
cd /Users/xavier/Codex/山屿/shanyu_erp
cp .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
```

把 `.env` 中的示例密码替换为本地专用密码。`.env` 已被 Git 忽略，
不得提交真实密码。

先检查基础设施：

```bash
docker compose ps
```

预期 PostgreSQL 和 MinIO 都显示 `running (healthy)`，并且只绑定在：

- PostgreSQL：`127.0.0.1:5432`
- MinIO API：`127.0.0.1:9000`
- MinIO Console：`127.0.0.1:9001`

### 提交前完整自检

先用 `Ctrl+C` 停止已运行的 `pnpm dev`，再执行：

```bash
pnpm check:env
```

脚本会按顺序完成：

1. 仓库与锁文件完整性。
2. Node.js `24.20.0` 和 pnpm `10.29.2` 精确版本。
3. `.env` 必需变量是否存在且非空，不打印值。
4. Docker Engine、Compose 配置和容器健康状态。
5. PostgreSQL 真实查询 `SELECT 1` 和 MinIO HTTP 探活。
6. localhost 端口绑定，避免开发数据库意外对外暴露。
7. `lint`、`typecheck`、`test` 和生产构建。
8. 在 `3000/3001` 临时启动构建产物，检查 Web 首页与 API `/health`。
9. 自动停止临时 Web/API 进程。

关键预期结果：

| 检查项 | 预期结果 |
| --- | --- |
| Node.js | `v24.20.0` |
| pnpm | `10.29.2` |
| PostgreSQL | `accepting connections`，且 `SELECT 1` 返回 `1` |
| MinIO | `/minio/health/live` 返回 HTTP 2xx |
| API | `/health` 返回包含 `"status":"ok"` 的 JSON |
| Web | `/` 返回 HTTP 2xx 或 3xx |
| 工程质量 | lint、类型检查、测试、构建全部退出码为 `0` |
| 最终汇总 | `FAIL=0  SKIP=0` |

### 开发服务运行中的快速检查

如果 `pnpm dev` 正在运行，不要同时执行 Next.js 生产构建，改用：

```bash
pnpm check:env:runtime
```

该模式会检查当前 Web/API 端点、Docker 基础设施和工具版本，
但会跳过 lint、类型检查、测试和构建。

## 生产服务器

生产自检必须在 Windows Server 中的 Ubuntu Linux 虚拟机内执行，
不在 Windows 宿主机上执行。它不要求服务器安装 Node.js 或 pnpm。

生产模式默认使用：

- `compose.prod.yaml`
- `.env.production`
- `SHANYU_HEALTH_URL`：公网 HTTPS API 健康地址。
- `SHANYU_BACKUP_DIR`：存放异机备份产物或同步成功标记的本地目录。
- `SHANYU_BACKUP_MAX_AGE_HOURS`：可选，默认要求 26 小时内有新备份。

示例：

```bash
cd /srv/shanyu-erp
SHANYU_HEALTH_URL=https://erp.example.com/api/health \
SHANYU_BACKUP_DIR=/srv/shanyu-backup-status \
bash scripts/environment-check.sh server
```

如果部署文件位于其他位置，可以额外设置：

```bash
SHANYU_COMPOSE_FILE=/srv/shanyu/compose.prod.yaml \
SHANYU_ENV_FILE=/srv/shanyu/secrets/.env.production \
SHANYU_HEALTH_URL=https://erp.example.com/api/health \
SHANYU_BACKUP_DIR=/srv/shanyu-backup-status \
bash scripts/environment-check.sh server
```

服务器预期结果：

- 操作系统为 Linux，Docker Engine 可连接。
- 生产环境文件权限为 `600` 或 `640`，数据库、MinIO 和三个 `ADMIN_*`
  初始化变量存在且非空。
- Compose 至少定义反向代理、Web、API、PostgreSQL 和 MinIO。
- 所有容器处于 `running (healthy)`，并配置自动重启策略。
- 所有容器使用 Docker `local` 日志驱动，或为其他驱动显式设置 `max-size` 轮转上限。
- Web `3000`、API `3001`、PostgreSQL `5432`、MinIO `9000/9001`
  未发布到宿主机，只在 Compose 内部网络中使用。
- 公网健康地址使用 HTTPS 并返回 HTTP 2xx。
- 磁盘使用率低于 90%。测试环境默认 26 小时内必须存在完整的
  `.dump + .meta + .sha256`；生产环境还必须存在对应的 `.dump.cos` 回读成功标记。

`compose.prod.yaml`、`.env.production` 或 `.release.env` 任一缺失时，服务器模式
会如实报告失败并跳过依赖这些文件的检查。

## 定时任务

服务器上建议使用 systemd timer，因为它可以记录退出码和日志。
以下是示例，实际路径和域名需在部署时替换。

`/etc/systemd/system/shanyu-env-check.service`：

```ini
[Unit]
Description=Shanyu ERP environment self-check
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=/srv/shanyu-erp
Environment=SHANYU_HEALTH_URL=https://erp.example.com/api/health
Environment=SHANYU_BACKUP_DIR=/srv/shanyu-backup-status
ExecStart=/usr/bin/bash scripts/environment-check.sh server
```

`/etc/systemd/system/shanyu-env-check.timer`：

```ini
[Unit]
Description=Run Shanyu ERP environment self-check every hour

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
Persistent=true

[Install]
WantedBy=timers.target
```

部署时由有管理权限的人人工安装该任务，然后检查：

```bash
systemctl status shanyu-env-check.timer
journalctl -u shanyu-env-check.service --since today
```

如果需要主动告警，后续可在 systemd 任务失败时调用已确定的
告警适配器；在告警通道确定前，不把密钥或 webhook 写入仓库。

## 常见失败

| 失败项 | 常见原因 | 处理 |
| --- | --- | --- |
| Node.js 版本错误 | Volta/nvm 尚未切换 | 回到仓库根目录后重新打开终端 |
| Docker daemon 失败 | Docker Desktop/Engine 未启动或当前用户无权访问 | 启动 Docker，再运行 `docker info` |
| 容器不健康 | 环境变量错误、端口冲突或数据卷问题 | 查看 `docker compose logs postgres minio` |
| `3000/3001` 已占用 | `pnpm dev` 仍在运行 | 停止开发进程，或改用 `pnpm check:env:runtime` |
| API 探活失败 | API 未启动、构建失败或端口被占用 | 检查脚本输出的 API 日志 |
| 生产 HTTPS 失败 | 证书、DNS、反向代理或 API 异常 | 从服务器内执行 `curl -v "$SHANYU_HEALTH_URL"` |
| 备份新鲜度失败 | 备份或异机同步任务停止 | 先检查备份任务日志，不用空文件伪造通过 |
