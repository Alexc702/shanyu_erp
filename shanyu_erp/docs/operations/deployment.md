# 山屿 ERP V1 部署与数据运维手册

| 文档属性 | 内容                           |
| ---- | ---------------------------- |
| 当前版本 | V1.5                         |
| 适用版本 | 山屿 ERP V1                    |
| 最后更新 | 2026-09-01                   |
| 适用环境 | 测试、预生产、生产                    |
| 当前状态 | ADMIN 部署候选已通过本地自动化；待重置测试环境并完成真实远程验收。生产 COS 自动链路待生产实跑 |

> 本手册用于首次部署、日常运维、数据备份、清空、迁移、恢复、版本升级与
> 回滚。它不替代业务验收用例，也不包含施工、财务模块。

## 目录

1. [能力边界与生产门禁](#1-能力边界与生产门禁)
2. [运行架构与环境基线](#2-运行架构与环境基线)
3. [目录、配置与密钥](#3-目录配置与密钥)
4. [首次部署与测试环境重新发布](#4-首次部署与测试环境重新发布)
5. [日常运维](#5-日常运维)
6. [数据备份与 COS 策略](#6-数据备份与-cos-策略)
7. [备份后清空用户数据](#7-备份后清空用户数据)
8. [从备份恢复](#8-从备份恢复)
9. [迁移到新环境](#9-迁移到新环境)
10. [版本升级与回滚](#10-版本升级与回滚)
11. [生产上线检查表](#11-生产上线检查表)
12. [故障处理](#12-故障处理)
13. [版本记录](#13-版本记录)
14. [腾讯云官方参考](#14-腾讯云官方参考)

## 1. 能力边界与生产门禁

### 1.1 当前能力状态

| 能力 | 测试环境状态 | 生产要求 |
| --- | --- | --- |
| Docker 首次部署 | OWNER 历史方案已验证；ADMIN 方案待下一次真实发布验收 | 使用不可变镜像版本重新验收 |
| 本机 PostgreSQL 备份 | 已验证 | 保留，作为恢复缓存和 COS 上传源 |
| 本机备份校验 | 已验证 | 每次备份必须执行 |
| 清空范围 A | OWNER 历史方案已演练；ADMIN 门禁自动化通过，待真实环境演练 | 仅经授权、双重确认后执行 |
| 本机恢复与失败回滚 | 已验证 | 生产数据副本上再次演练 |
| 两台服务器间迁移 | 已验证 | 正式切换前再次演练 |
| COS 上传、回读校验 | 不配置、不访问 COS | 已实现；随生产版本发布后完成首次真实定时任务验证 |
| COS 跨地域副本 | 尚未配置 | 正式生产推荐启用 |

生产环境不得只依赖服务器系统盘。只有一次备份同时满足以下条件，才可记为
“生产备份成功”：

1. 本机 `.dump`、`.dump.meta`、`.dump.sha256` 三个文件均已生成。
2. 本机 SHA-256、元信息和 `pg_restore --list` 校验通过。
3. 三个文件已上传至私有 COS 存储桶；校验文件最后上传。
4. COS 中三个对象均可读取，大小符合预期。
5. 从 COS 回读到临时目录后，再次通过本机完整校验。
6. 本机写入 `.dump.cos` 成功标记；任何一步失败都会使
   systemd 任务失败且不执行本机过期清理。

> 当前失败证据记录在 systemd journal；外部通知通道仍是生产上线门禁，
> 不得把“有失败日志”表述为“已有自动告警”。

### 1.2 默认恢复目标

- RPO：每天 `02:30` 备份，默认最多丢失 24 小时数据；发布、清空和恢复前
  另行创建即时备份。
- RTO：不在文档中承诺固定时长，以生产数据量的隔离恢复演练结果为准。
- 本机保留：30 天。
- COS 保留：默认 180 天；首次 COS 恢复演练通过前不配置自动删除。
- 恢复演练：生产上线前一次，此后至少每季度一次，并保留验收记录。

## 2. 运行架构与环境基线

运行拓扑：

```text
Internet
   │
   ▼
Caddy :80/:443
   ├── Next.js Web :3000
   └── NestJS API :3001
           │
           ▼
      PostgreSQL :5432
```

只有 Caddy 发布宿主机 80/443。Web 3000、API 3001、PostgreSQL 5432 和
MinIO 9000/9001 均不发布到公网。

### 2.1 环境差异

| 项目 | 测试环境 | 生产环境 |
| --- | --- | --- |
| 主机 | 当前 2GB 云服务器 | 根据压力测试确定容量 |
| 对象存储 profile | 不启动 | 按 ADR-0002 的最终方案执行 |
| PostgreSQL 备份 | 本机 30 天 | 本机 30 天 + COS 180 天 |
| 备份模式 | `test` + `local` | `production` + `cos`，禁止降级为仅本机 |
| COS 跨地域复制 | 可不启用 | 推荐启用 |
| 域名与 TLS | 可临时使用 HTTP/IP | 必须使用域名与 HTTPS |
| 镜像来源 | Mac 构建后上传 | CI 构建并发布不可变镜像 |

当前业务导出文件仍保存在 PostgreSQL。COS 数据库备份和 ADR-0002 中的业务
对象存储迁移是两项不同工作，不能相互替代。

### 2.2 服务器基线

- Ubuntu 24.04 LTS，`x86_64`。
- 密钥登录的非 root 运维账号，具备免交互 `sudo`。
- Docker Engine 与 Docker Compose 已启用并随系统启动。
- 系统时区为 `Asia/Shanghai`，NTP 正常。
- 云防火墙与 UFW 只放行 SSH、HTTP、HTTPS。

## 3. 目录、配置与密钥

| 路径 | 用途 | 权限要求 |
| --- | --- | --- |
| `/srv/shanyu-erp` | 应用部署根目录 | 运维账号可读写 |
| `/srv/shanyu-erp/.env.production` | 生产环境变量 | `600` |
| `/srv/shanyu-erp/backups` | 本机备份目录 | `750`，备份文件为 `600` |
| `/etc/shanyu-erp/cos.yaml` | 生产 COSCLI 配置 | `root:root`、`600`；测试环境不创建 |

除用户明确批准的空库 ADMIN 固定初始化口令外，任何数据库密码、ADMIN 实际使用
密码、COS SecretId、SecretKey 或临时 Token 都不得提交到 Git、写入部署文档或
输出到 CI 日志。固定初始化口令属于已知凭据，只用于建立首个 ADMIN；首次验收后
必须在“用户与权限”页面重设密码。

生产服务器使用已验证的最小权限 COS 身份，只允许指定桶中
`shanyu-erp/production/postgresql/` 前缀的上传、查询和下载，不授予删除、
其他前缀或全资源权限。密钥只能存在上述 root 专用配置中。

## 4. 首次部署与测试环境重新发布

### 4.1 配置主机防火墙

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw limit 22/tcp comment "SSH key login"
sudo ufw allow 80/tcp comment "Shanyu ERP HTTP"
sudo ufw allow 443/tcp comment "Shanyu ERP HTTPS"
sudo ufw --force enable
```

启用后必须另开一条 SSH 连接确认仍能登录。发布脚本复用一条 SSH 连接，
不会因连续执行多个远程步骤而触发 22 端口限速。

### 4.2 从 Mac 首次发布或重新发布测试环境

当前测试环境由 Mac 构建生产镜像后通过 SSH 上传。首次部署和后续重新发布
使用同一个 `publish-from-mac.sh`，但执行前必须先完成以下检查：

```bash
cd /Users/xavier/Codex/山屿/shanyu_erp
git status --short
git diff --check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

发布脚本会构建当前工作目录中的全部源代码，而不只是最近一个修改。正式
发布前应提交 Git，确保发布版本可追溯。测试环境确需发布未提交代码时，必须
逐项核对 `git status --short`，使用明确的测试版本号，并在验收记录中保存
对应 diff；不得使用默认 Git SHA 冒充干净版本。

在 Mac 仓库根目录执行：

```bash
bash scripts/deployment/publish-from-mac.sh \
  shanyu-erp-test \
  http://115.159.50.166 \
  v1-test-YYYYMMDD-change-name
```

例如发布 HTTP 环境的 `crypto.randomUUID()` 兼容修复：

```bash
bash scripts/deployment/publish-from-mac.sh \
  shanyu-erp-test \
  http://115.159.50.166 \
  v1-test-20260901-randomuuid
```

第三个参数是镜像 tag 和应用发布版本，只能使用 Docker tag 支持的字母、数字、
点、下划线和连字符，不能包含空格或中文。

发布脚本默认构建 `linux/amd64` 镜像，因此 Apple Silicon Mac 可直接发布到
`x86_64` 云服务器。只有目标服务器为其他架构时才设置
`SHANYU_TARGET_PLATFORM`。

发布脚本会：

1. 在 Mac 构建 Web/API 生产镜像。
2. 上传 Compose、Caddy 和运维脚本到 `/srv/shanyu-erp`。
3. 首次部署时生成权限为 `600` 的环境文件，不打印数据库密码。
4. 把镜像压缩传到服务器，服务器不执行构建。
5. 启动 PostgreSQL；已有业务表时先完成可验证备份，再执行向前迁移，并在空库
   创建首个 ADMIN 后启动完整应用。
6. 执行健康检查并创建一份本机逻辑备份。

首次部署与重新发布的差异：

| 行为 | 首次部署 | 测试环境重新发布 |
| --- | --- | --- |
| `.env.production` | 不存在时安全生成 | 保留已有文件，不覆盖密码与环境配置 |
| 应用镜像 | 首次上传 | 上传并切换到新版本 |
| PostgreSQL 数据卷 | 创建 | 保留，不清空业务数据 |
| 数据库迁移 | 执行向前迁移 | 执行尚未应用的向前迁移 |
| ADMIN | 数据库中没有 ADMIN 时创建 | 已存在任意 ADMIN 时不修改账号、显示名称或密码 |
| 数据备份 | 部署前后创建 | 部署前后创建 |

不要只在服务器执行 `server-deploy.sh` 来发布 Mac 上的新代码。该命令不会
构建或上传镜像，只会使用服务器已经存在、且 `.release.env` 已选择的镜像。

任何环境都不得执行 `pnpm db:seed`。

### 4.3 初始 ADMIN

全新数据库首次部署后预期账号为 `admin`，显示名称为“系统管理员”。初始密码由
服务器权限为 `600` 的 `.env.production` 提供，不通过命令、文档或日志打印。
初始化脚本只在数据库不存在 ADMIN 时使用该密码；已有 ADMIN 时重复部署不会修改
其账号、显示名称或密码，也不会初始化 OWNER。

首次验收完成后，在“用户与权限”页面为 ADMIN 本人重设密码。后续部署只检查
ADMIN 是否已存在，不会把密码恢复为初始值。

### 4.4 旧测试环境一次性重置

2026-09-01 已确认：当前仍以 OWNER 为基线的测试服务器可以放弃现有业务数据，
不执行 OWNER→ADMIN 数据迁移，而是在下一次发布时重置为全新数据库后重新部署。
该授权只适用于当前测试环境，执行时必须解析并再次核对精确 SSH 主机、Compose
项目和 PostgreSQL 命名卷；不得用于生产环境，也不得删除备份目录。

重置后必须满足：空库迁移成功、只自动创建一个 ADMIN、不自动创建 OWNER、
重新由 ADMIN 导入并发布 V3 主材库 161 项，然后运行 4.5 的完整自动验收。

### 4.5 发布验收

```bash
cd /srv/shanyu-erp
sudo docker compose \
  --project-directory /srv/shanyu-erp \
  --env-file .env.production \
  --env-file .release.env \
  -f compose.prod.yaml \
  ps
curl --fail --silent --show-error http://127.0.0.1/api/health
cat last-successful-deploy
sed -n 's/^RELEASE_VERSION=//p' .release.env
```

确认所有容器为 `healthy`、健康接口返回成功、服务器版本等于本次发布版本。
随后在 Mac 执行自动环境验收；密码不会写入参数或输出：

```bash
read -r -s -p 'ADMIN 密码：' SHANYU_ADMIN_PASSWORD; echo
export SHANYU_ADMIN_PASSWORD
SHANYU_EXPECT_FRESH_ADMIN_ONLY=1 \
  bash scripts/deployment/verify-deployment-from-mac.sh \
  shanyu-erp-test http://115.159.50.166 <本次发布版本>
unset SHANYU_ADMIN_PASSWORD
```

脚本会通过 SSH 执行服务器自检并核对发布版本，再通过公网 API 实际验证健康检查、
ADMIN 登录、Session、用户列表和退出。全新环境模式要求用户列表只有初始化的
ADMIN。测试环境随后至少回归本次变更页面、项目列表及相关权限；首次部署和生产
候选版本必须执行完整 V1 验收用例。

## 5. 日常运维

### 5.1 查看状态与日志

```bash
cd /srv/shanyu-erp
sudo docker compose \
  --project-directory /srv/shanyu-erp \
  --env-file .env.production \
  --env-file .release.env \
  -f compose.prod.yaml \
  ps
sudo docker compose \
  --project-directory /srv/shanyu-erp \
  --env-file .env.production \
  --env-file .release.env \
  -f compose.prod.yaml \
  logs --tail=200 caddy web api postgres
```

### 5.2 重新部署服务器已有镜像

```bash
cd /srv/shanyu-erp
bash scripts/deployment/server-deploy.sh
```

该命令适用于服务器文件或容器状态已准备好、只需按当前 `.release.env` 重新
执行备份、迁移、启动与健康检查的情况。它不是从 Mac 重新发布代码的替代品。

### 5.3 健康检查

```bash
curl --fail --silent --show-error https://你的正式域名/api/health
```

健康接口失败时先查看容器状态和日志，不要直接清空数据卷或恢复备份。

## 6. 数据备份与 COS 策略

### 6.1 本机备份格式与并发保护

所有数据操作共用一把互斥锁，不允许备份、清空或恢复并发执行。每份备份
由三个同名文件组成：

| 文件 | 内容 |
| --- | --- |
| `shanyu-erp-<UTC时间>.dump` | PostgreSQL 自定义格式备份 |
| `shanyu-erp-<UTC时间>.dump.meta` | 版本和关键业务表数量 |
| `shanyu-erp-<UTC时间>.dump.sha256` | 同时覆盖 `.dump` 与 `.meta` 的 SHA-256 |

只有文件非空、两项 SHA-256 一致且 `pg_restore --list` 可读取时，本机备份
才会报告成功。

### 6.2 手工创建并验证完整备份链路

```bash
cd /srv/shanyu-erp
bash scripts/deployment/server-backup.sh
bash scripts/deployment/server-verify-backup.sh \
  /srv/shanyu-erp/backups/shanyu-erp-YYYYMMDDTHHMMSS-NNNNNNNNNZ.dump
```

`server-backup.sh` 会根据 `.env.production` 强制执行不同的环境边界：

- 测试环境：`SHANYU_DEPLOYMENT_ENVIRONMENT=test` 且
  `SHANYU_BACKUP_MODE=local`，只生成并验证本机三件套，不访问 COS。
- 生产环境：`SHANYU_DEPLOYMENT_ENVIRONMENT=production` 且
  `SHANYU_BACKUP_MODE=cos`，必须完成本机校验、COS 上传、对象查询和回读
  复验才返回成功；不允许改成 `local` 绕过 COS。

生产成功后会额外生成同名 `.dump.cos` 标记，记录远程对象 URI 和回读
验证时间；它不包含密钥。没有这个标记的生产备份不能记为 COS 备份成功。

### 6.3 本机定时备份

安装每天 `02:30` 执行、保留 30 天的 systemd 定时任务：

```bash
cd /srv/shanyu-erp
bash scripts/deployment/server-install-backup-timer.sh
sudo systemctl list-timers shanyu-erp-backup.timer
sudo journalctl -u shanyu-erp-backup.service --no-pager -n 100
```

定时任务使用宿主机 `Asia/Shanghai` 时区；若错过执行时间，
`Persistent=true` 会在下次开机后补执行。本机清理仅匹配备份目录顶层的
`shanyu-erp-*.dump`、`.dump.sha256`、`.dump.meta`、`.dump.cos`，不递归删除
其他路径。

同一个 systemd 定时任务在测试环境只执行本机备份，在生产环境自动执行
COS 链路。生产上传、`stat` 或回读校验任意一步失败时，任务退出码非 0，
后续本机保留期清理不会执行。

### 6.4 正式环境 COS 自动备份

生产备份链路：

```text
pg_dump
  → 本机 .pending 文件
  → 原子改名为三件套
  → SHA-256 + pg_restore 校验
  → 上传 COS（dump → meta → sha256）
  → COS 对象存在性/大小检查
  → 回读临时目录并再次完整校验
  → 记录成功并执行本机保留策略
```

COS 存储桶采用以下默认值：

| 项目 | 正式环境默认值 |
| --- | --- |
| 存储桶用途 | 仅存放山屿 ERP 数据库备份，不与业务附件混用 |
| 访问权限 | 私有读写，禁止公有访问 |
| 对象前缀 | `shanyu-erp/production/postgresql/YYYY/MM/<backup-id>/` |
| 身份 | 生产专用最小权限 CAM 身份；密钥仅存于 root 专用配置 |
| 传输 | HTTPS |
| 静态加密 | SSE-COS |
| 数据冗余 | 单 AZ（当前已购买规格） |
| 版本控制 | 开启 |
| 本机保留 | 30 天 |
| COS 保留 | 180 天 |
| 跨地域复制 | 生产推荐启用到另一地域的私有桶 |

若启用跨地域复制，源存储桶必须先开启版本控制。目标存储桶需要独立配置
访问控制、加密、生命周期和告警，不能假设它自动继承源桶配置。

### 6.5 COSCLI 安装与身份配置

1. 从腾讯云官方页面下载与服务器架构匹配的固定版本 COSCLI。
2. 按官方页面给出的 SHA-256 校验二进制，不使用未校验的下载文件。
3. 安装到 `/usr/local/bin/coscli`，确认 `coscli --version`。
4. 将已验证的 COSCLI 配置安装为 `/etc/shanyu-erp/cos.yaml`，执行
   `sudo chown root:root /etc/shanyu-erp/cos.yaml` 与
   `sudo chmod 600 /etc/shanyu-erp/cos.yaml`。
5. 配置中的桶别名使用 `shanyu-backup`，协议保持 `https`。
6. 最小权限身份只授予指定桶和生产前缀所需的上传、查询、下载权限，
   不授予删除、`resource:*` 或 `action:*`。

全新 HTTPS 生产环境由 `server-initialize-env.sh` 自动写入下列非密钥配置。
如果生产 `.env.production` 早于 V1.4 已经存在，不得重新生成或覆盖整个文件；
只在确认缺失时手工追加这些行：

```text
SHANYU_DEPLOYMENT_ENVIRONMENT=production
SHANYU_BACKUP_MODE=cos
SHANYU_COSCLI_PATH=/usr/local/bin/coscli
SHANYU_COS_CONFIG_PATH=/etc/shanyu-erp/cos.yaml
SHANYU_COS_BUCKET_ALIAS=shanyu-backup
SHANYU_COS_BACKUP_PREFIX=shanyu-erp/production/postgresql
```

测试环境没有 COS，不得追加生产 COS 配置。旧的 HTTP 测试环境即使尚无
`SHANYU_DEPLOYMENT_ENVIRONMENT` 和 `SHANYU_BACKUP_MODE`，脚本也会向后兼容为
`test + local`；后续可明确补入这两个值，但不需要 COSCLI 或 COS 配置。

COSCLI 上传、查询和下载至少涉及官方 `cp`、`stat` 所列的对象与分块上传
权限。正式策略应按官方权限列表生成并经过“可上传、可回读、不可访问其他
前缀”的反向测试。

### 6.6 生产首次自动备份验证

将包含本次脚本的版本发布到生产服务器后，先确认环境边界：

```bash
cd /srv/shanyu-erp
grep -E '^SHANYU_(DEPLOYMENT_ENVIRONMENT|BACKUP_MODE|COSCLI_PATH|COS_CONFIG_PATH|COS_BUCKET_ALIAS|COS_BACKUP_PREFIX)=' \
  .env.production
sudo stat -c '%U:%G %a %n' /etc/shanyu-erp/cos.yaml
bash scripts/deployment/server-backup.sh
ls -lt backups/shanyu-erp-*.dump.cos | head -n 1
```

预期日志同时出现 `COS backup uploaded and read-back verified` 和
`Created PostgreSQL backup`。`.dump.cos` 中的 `remote_uri` 必须位于
`cos://shanyu-backup/shanyu-erp/production/postgresql/` 下。再手工触发一次
systemd 服务：

```bash
sudo systemctl start shanyu-erp-backup.service
sudo systemctl status shanyu-erp-backup.service --no-pager
sudo journalctl -u shanyu-erp-backup.service --no-pager -n 200
```

必须看到退出成功和本次 `.dump.cos` 标记，才可认为生产定时链路已接通。

COSCLI 默认支持 CRC64 传输校验，但 CRC64 不能替代本项目三件套中的
SHA-256 和 `pg_restore` 可读性检查。

### 6.7 生命周期与删除保护

首次 COS 恢复演练通过前，不启用自动到期删除。演练通过后：

1. 为生产前缀配置 180 天到期策略。
2. 已开启版本控制时，同时配置当前版本与历史版本的生命周期。
3. 如需降低成本，可在确认恢复时效后再配置向低频或归档类型沉降。
4. 归档对象恢复前必须先在 COS 完成取回，不能直接交给数据库恢复脚本。
5. 生命周期规则按 COS 的异步调度执行，不把“配置已保存”当作“对象已处理”。

修改生命周期、版本控制、跨地域复制或加密策略属于生产变更，必须记录
操作人、时间、规则内容和回滚方式。

### 6.8 COS 备份自动化验收状态

已由 `server-backup-to-cos.sh` 实现并通过本地故障注入测试：

- 本机校验失败时不上传。
- 任一 COS 上传或回读校验失败时退出码非 0，不执行本机过期清理。
- 三件套使用唯一对象前缀，校验文件最后上传。
- 日志不输出密钥、Token、数据库密码或备份内容。
- 生产必须使用 COS，测试环境必须仅本机，配置反向时会立即拒绝。

生产上线前仍需完成：

- 发布后按 6.6 执行真实 COS 自动备份和 systemd 调用。
- 接入连续失败的外部告警，包含环境、备份 ID、失败步骤和日志入口。
- 从 COS 指定对象版本下载并在隔离数据库完成真实恢复，确认
  业务数量与 `.meta` 全部一致。

## 7. 备份后清空用户数据

脚本先创建并验证新备份，然后在 TTY 中要求两次精确输入。不支持环境变量
跳过确认，也拒绝无交互 TTY 的运行方式：

```bash
cd /srv/shanyu-erp
bash scripts/deployment/server-backup-and-clear-user-data.sh
```

### 7.1 范围 A 删除内容

- 项目、空间。
- 报价草稿和已提交快照、审批、版本、导出。
- 所有非 ADMIN 用户、凭证和会话。
- 与上述项目、报价和用户相关的审计记录。

### 7.2 范围 A 保留内容

- 至少一个有效 ADMIN 账号及其凭证。
- 数据库结构、迁移记录和数量规则。
- 主材库数据，并强制校验已发布批次的源文件为
  `半包报价单_v3.xlsx` 的精确 SHA-256，且共 161 项。

业务资料 V3 不等于数据库首次发布时生成的内部 `version_number=1`。

如果不存在有效 ADMIN、V3 不是 161 项，或被保留的主材库仍引用待删除的非
ADMIN 用户，脚本会在显示确认之前拒绝执行。清空完成后会复核业务表全为 0、
非 ADMIN 用户为 0、至少一个有效 ADMIN、`V3=161` 以及目录指纹未变，然后才
重启应用。历史主材库由 OWNER 发布本身合法；只有在同时要求删除该 OWNER 并保留
其发布记录时才会触发此保护门禁。

生产环境执行范围 A 前，内部调用的 `server-backup.sh` 必须完成同一份备份的
COS 上传与回读校验。任何 COS 错误都会在显示第一次清空确认前终止操作。
测试环境没有 COS，仍使用经校验的本机备份作为恢复点。

## 8. 从备份恢复

### 8.1 从本机备份恢复

恢复脚本先验证指定备份，无条件创建当前环境的安全备份，再要求两次精确
确认。该安全备份在生产环境也必须先通过 COS 上传和回读，否则不会进入确认和
数据替换：

```bash
cd /srv/shanyu-erp
bash scripts/deployment/server-restore-backup.sh \
  /srv/shanyu-erp/backups/shanyu-erp-YYYYMMDDTHHMMSS-NNNNNNNNNZ.dump
```

指定备份会替换整个 PostgreSQL 数据库。恢复后脚本会：

1. 执行向前迁移。
2. 将实际数量与 `.meta` 中的用户、目录、项目、报价、审批、导出和审计数量
   逐项对比。
3. 检查公网健康接口。
4. 任一步失败时，自动使用操作前安全备份回滚。

指定备份与操作前安全备份都会保留供人工审核。

### 8.2 从 COS 恢复

1. 在 COS 中确认环境、备份 ID、对象版本、创建时间和 `.meta` 数量。
2. 若对象已归档，先执行 COS 取回并等待对象可下载。
3. 把 `.dump`、`.dump.meta`、`.dump.sha256` 下载到
   `/srv/shanyu-erp/backups/imported/` 的独立目录。
4. 执行 `server-verify-backup.sh`，不得跳过 SHA-256 与 `pg_restore` 检查。
5. 使用上一节的 `server-restore-backup.sh` 恢复。
6. 完成浏览器业务验收，记录恢复时长、备份版本和结果。

生产恢复不得直接从 COS 流式写入 PostgreSQL；必须先完整下载并验证三件套。

## 9. 迁移到新环境

### 9.1 服务器间迁移

源端和目标端都应先完成首次部署，且 Mac 能通过 SSH 别名登录两台服务器。
在 Mac 仓库根目录执行：

```bash
bash scripts/deployment/migrate-backup-between-servers.sh \
  shanyu-erp-test \
  /srv/shanyu-erp/backups/shanyu-erp-YYYYMMDDTHHMMSS-NNNNNNNNNZ.dump \
  shanyu-erp-production
```

脚本先在源端验证校验和与 `pg_restore` 可读性，再通过 SSH 流式传输到目标端
`/srv/shanyu-erp/backups/imported/`。传输使用 `.pending` 临时文件避免半成品被
识别为备份，并在目标端再次校验。迁移只传输备份，不自动恢复。

### 9.2 通过 COS 迁移

新生产环境优先从 COS 获取备份：

1. 给新 CVM 绑定仅能读取指定生产备份前缀的实例角色。
2. 下载指定备份三件套或指定对象版本。
3. 在新环境执行完整校验。
4. 执行恢复脚本并完成浏览器验收。
5. 验收通过后，才切换域名或入口流量。
6. 新环境 COS 写入链路验证通过后，才停用旧环境定时任务。

### 9.3 服务器自检

```bash
cd /srv/shanyu-erp
sudo env \
  SHANYU_HEALTH_URL=http://115.159.50.166/api/health \
  SHANYU_BACKUP_DIR=/srv/shanyu-erp/backups \
  bash scripts/environment-check.sh server-test
```

## 10. 版本升级与回滚

### 10.1 镜像仓库升级

未来 CI 将镜像发布到仓库后执行：

```bash
cd /srv/shanyu-erp
SHANYU_PULL_IMAGES=1 bash scripts/deployment/server-upgrade.sh \
  ghcr.io/example/shanyu-erp-api:v1.0.1 \
  ghcr.io/example/shanyu-erp-web:v1.0.1 \
  v1.0.1
```

升级前会创建 PostgreSQL 备份，并保留上一组镜像选择。生产环境的该备份
已强制接入 COS 上传和回读校验；失败时 `server-deploy.sh` 立即退出，不会执行
数据库迁移或切换应用。数据库迁移必须保持向后兼容。

### 10.2 应用镜像回滚

```bash
cd /srv/shanyu-erp
bash scripts/deployment/server-rollback.sh
```

回滚不删除数据卷，不执行数据库 `down` 迁移。如新迁移与旧应用不兼容，
需在隔离环境使用升级前备份恢复，不在原数据卷上直接覆盖。

## 11. 生产上线检查表

### 11.1 基础设施

- [ ] 域名已解析到服务器。
- [ ] `CADDY_SITE_ADDRESS` 使用域名。
- [ ] `WEB_ORIGIN` 使用 `https://...`。
- [ ] `SESSION_COOKIE_SECURE=true`。
- [ ] `SHANYU_DEPLOYMENT_ENVIRONMENT=production` 且 `SHANYU_BACKUP_MODE=cos`。
- [ ] 云防火墙与 UFW 只放行必要端口。
- [ ] 生产容量已依据压力测试确定，未直接沿用 2GB 测试机规格。

### 11.2 应用与镜像

- [ ] Web/API 镜像由 CI 发布，使用不可变 tag 或 digest。
- [ ] 服务器镜像仓库凭证只有拉取权限。
- [ ] 数据库迁移已在生产数据副本验证。
- [ ] 完整 V1 自动化测试与浏览器验收通过。

### 11.3 COS 与恢复

- [ ] 备份桶为私有读写，未开启任何公有访问。
- [ ] CVM 使用实例角色或最小权限临时凭证。
- [ ] 传输使用 HTTPS，静态加密已启用。
- [ ] 版本控制已开启。
- [ ] `/etc/shanyu-erp/cos.yaml` 为 `root:root 600`，未将密钥写入 Git 或日志。
- [ ] 生命周期已覆盖当前版本与历史版本。
- [ ] 真实 COS 自动上传、对象检查和回读校验已按 6.6 通过。
- [ ] 定时备份失败外部告警已通过真实通知演练。
- [ ] 已从 COS 在隔离环境完成真实恢复，业务数量与 `.meta` 一致。
- [ ] 已记录实际 RPO、RTO 和恢复负责人。
- [ ] 跨地域复制已启用，或已记录暂缓原因与风险接受人。

以上任一关键项未完成，平台只能作为测试或预生产环境，不能宣称生产就绪。

## 12. 故障处理

### 12.1 定时备份失败

```bash
sudo systemctl status shanyu-erp-backup.service --no-pager
sudo journalctl -u shanyu-erp-backup.service --no-pager -n 200
```

先保留失败文件和日志，再检查 PostgreSQL、磁盘空间、操作锁、COS 身份、网络
和存储桶策略。不得为了让任务“变绿”而跳过验证或删除现存备份。

### 12.2 COS 上传成功但回读失败

把该次任务视为失败；不要执行本机过期清理。检查对象权限、对象版本、存储
类型、加密权限和下载日志。修复后必须重新回读并通过完整验证。

### 12.3 恢复失败

保持 PostgreSQL 隔离，保留指定备份和自动生成的操作前安全备份。先确认
恢复脚本是否已自动回滚成功，再决定是否重新执行。不得手工删除数据卷。

## 13. 版本记录

| 版本 | 日期 | 变更内容 |
| --- | --- | --- |
| V1.0 | 2026-08-31 | 建立 Docker 首次发布、服务器部署、镜像升级和应用回滚流程。 |
| V1.1 | 2026-08-31 | 增加经验证的本机定时备份、范围 A 清空、服务器间迁移、恢复前安全备份与失败自动回滚。 |
| V1.2 | 2026-08-31 | 重构手册结构；增加能力状态、生产门禁、COS 私有备份、加密、版本控制、生命周期、跨地域复制、回读校验和 COS 恢复流程。 |
| V1.3 | 2026-09-01 | 明确测试环境重新发布流程、Git 与质量门禁、显式发布版本、首次与重复发布差异；区分 Mac 发布、服务器已有镜像部署和生产镜像仓库升级，并修正 Compose 验收命令。 |
| V1.4 | 2026-09-01 | 接入生产 COS 自动上传、对象查询、回读复验和成功标记；强制测试环境仅本地、生产环境必须 COS，并增加上传失败和回读损坏故障注入测试。 |
| V1.5 | 2026-09-01 | 首次账号统一为 ADMIN；增加已有数据库迁移前强制备份、ADMIN 与完整备份自检、Mac 驱动的远程发布验收、发布参数校验，并记录旧测试环境一次性重置口径。 |

## 14. 腾讯云官方参考

- [COSCLI 下载与安装配置](https://cloud.tencent.com/document/product/436/63144)
- [COSCLI 上传下载或拷贝文件](https://cloud.tencent.com/document/product/436/63669)
- [COSCLI 查询对象元数据](https://cloud.tencent.com/document/product/436/136958)
- [COSCLI 获取文件哈希值](https://cloud.tencent.com/document/product/436/63672)
- [COS 访问控制基本概念](https://cloud.tencent.com/document/product/436/30749)
- [COS 服务端加密概述](https://intl.cloud.tencent.com/zh/document/product/436/18145?lang=zh)
- [COS 配置生命周期](https://cloud.tencent.com/document/product/436/17031)
- [COS 跨地域复制](https://intl.cloud.tencent.com/zh/document/product/436/35859)
