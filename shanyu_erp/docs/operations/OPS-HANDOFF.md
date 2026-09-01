# 山屿 ERP 运维 Ops 对话 Handoff

> 快照时间：2026-09-01（Asia/Shanghai，ADMIN 部署复审后更新）  
> 用途：在新的 Codex 对话中继续山屿 ERP 的云资源、部署、备份、恢复、升级和
> 生产上线工作。该对话应与 ERP 业务功能开发分离。

## 1. 新对话启动指令

新对话开始后，按顺序执行：

1. 完整阅读 `~/.codex/AGENTS.md` 和仓库根目录 `AGENTS.md`。
2. 工作目录固定为 `/Users/xavier/Codex/山屿/shanyu_erp`。
3. 阅读本文件，然后阅读下列权威资料：
   - `docs/operations/deployment.md`
   - `docs/reviews/v1-cloud-deployment-test-2026-08-31.md`
   - `docs/adr/0003-portable-linux-compose-deployment.md`
   - `README.md` 的“生产运行边界”
4. 执行只读检查：`git status --short`、`git branch --show-current`、
   `git remote -v`、`git log -5 --oneline`。
5. 如任务涉及真实服务器，再通过 SSH 别名 `shanyu-erp-test` 做只读状态核查；
   先确认稳定状态，再制定变更计划。
6. 先向用户汇报当前状态、计划、风险和验收标准，再执行任何会改变云资源、
   服务器、数据库或 Git 状态的操作。

启动完成标准：新对话明确知道当前 Git 脏工作区、测试服务器发布版本、备份
能力边界和生产剩余门禁，并且尚未覆盖任何现有文件或数据。

## 2. 对话范围

### 2.1 包含

- 腾讯云服务器、云防火墙、域名、TLS、COS、CAM/CVM 实例角色。
- Docker、Compose、Caddy、Web/API/PostgreSQL 容器运行。
- 首次部署、重新发布、健康检查、日志、巡检和告警。
- 数据库备份、校验、保留、清空、迁移、恢复和恢复演练。
- CI、镜像仓库、不可变镜像、升级与回滚。
- 生产容量、安全加固和上线门禁。
- 为上述能力编写脚本、自动化测试、部署文档和运维验收记录。

### 2.2 默认不包含

- 报价、项目、审批、主材库等业务需求或 UI 调整。
- 施工和财务功能开发。
- 未经用户明确授权的生产数据修改、外部发布或云资源购买。

若运维问题实际由应用缺陷导致，先诊断并报告影响；只有用户明确要求修复时，
才修改业务代码。

## 3. 权威资料与优先级

| 优先级 | 资料 | 用途 |
| --- | --- | --- |
| 1 | 用户在新对话中的最新确认 | 当前授权、目标和风险选择 |
| 2 | `docs/operations/deployment.md` | 所有部署、备份、恢复、升级和回滚操作 |
| 3 | `docs/reviews/v1-cloud-deployment-test-2026-08-31.md` | 已执行测试及其证据 |
| 4 | `docs/adr/0003-portable-linux-compose-deployment.md` | 可移植 Linux Compose 部署决策 |
| 5 | `compose.prod.yaml`、`Caddyfile`、`.env.production.example` | 当前运行配置事实 |
| 6 | `scripts/deployment/` | 脚本的真实行为和参数 |

命令和流程发生冲突时，以脚本当前实现为事实，以部署手册为预期；发现不一致
先报告并修正文档或实现，不能静默选择。

## 4. 仓库与 Git 快照

- 仓库：`git@github.com:Alexc702/shanyu_erp.git`
- 分支：`main`
- 本次复审时 `HEAD` 与 `origin/main`：
  `3190595 feat: 优化半包报价编辑页与版本管理文案`
- V1 阶段 1–7 的业务功能已经完成验收并提交。

### 4.1 重要：工作区不是干净的

handoff 创建时存在大量用户和前序任务的未提交修改。必须保留它们，不得执行
`git reset --hard`、`git checkout --`、`git clean` 或批量覆盖。

与 Ops 直接相关的状态快照：

```text
 M README.md
 M package.json
 M pnpm-lock.yaml
 M scripts/environment-check.sh
?? .dockerignore
?? .env.production.example
?? Caddyfile
?? Dockerfile
?? apps/api/scripts/bootstrap-admin.mjs
?? apps/api/test/session-cookie.spec.ts
?? apps/web/src/lib/api-url.ts
?? apps/web/src/lib/server-api-url.ts
?? compose.prod.yaml
?? docs/adr/0003-portable-linux-compose-deployment.md
?? docs/operations/deployment.md
?? docs/reviews/v1-cloud-deployment-test-2026-08-31.md
?? scripts/deployment/
```

这只是创建 handoff 时的快照；每次操作前重新执行 `git status --short`。
业务文件也存在其他未提交修改，Ops 对话不得顺手整理或提交它们。

### 4.2 发布可追溯性风险

`publish-from-mac.sh` 构建的是 Mac 当前工作目录，而不是 Git 提交的干净检出。
默认发布标签只是 `<HEAD短SHA>-<UTC时间>`。因此当前云端标签虽然以
`17efe88` 开头，也可能包含未提交修改，不能据此断言镜像可由该提交复现。

后续正式发布必须：

1. 明确哪些文件属于 Ops 交付。
2. 将它们与业务修改分开审阅和提交。
3. 在干净、可追溯的提交或 CI 工作区构建镜像。
4. 用不可变 tag 或 digest 记录发布物。

## 5. 腾讯云测试资源

### 5.1 实例

| 项目 | 当前值 |
| --- | --- |
| 云厂商 | 腾讯云轻量应用服务器 |
| 实例 ID | `lhins-8nxaxsyq` |
| 镜像标识 | `Ubuntu24.04-Docker29-aDlr`（控制台显示值） |
| 地域 | 上海 |
| 公网 IPv4 | `115.159.50.166` |
| 内网 IPv4 | `10.0.0.17` |
| 主机名 | `VM-0-17-ubuntu` |
| 操作系统 | Ubuntu 24.04 LTS（曾核验为 24.04.4） |
| 架构 | `x86_64` |
| 规格 | 2 vCPU、2GB 内存、40GB 系统盘 |
| Swap | 约 1.9GB，已启用 |
| 时区 | `Asia/Shanghai`，NTP 已同步 |
| Docker Engine | 29.6.1 |
| Docker Compose | v5.3.1 |
| 控制台到期时间 | 2026-09-30 18:19:46；续费或迁移前需重新核对 |

这是短期测试/验收服务器，不是生产容量基线。

### 5.2 SSH

- Mac SSH 别名：`shanyu-erp-test`
- 解析目标：`ubuntu@115.159.50.166:22`
- `IdentitiesOnly=yes`，私钥已在 Mac 本地配置，不复制到仓库或 handoff。
- `ubuntu` 可执行免交互 `sudo`。
- 当前 sshd：公钥登录开启；root 登录、密码登录和 keyboard-interactive 登录关闭。
- 云防火墙的 SSH 来源暂时允许全部 IPv4，因为用户出口 IP 会变化；这是测试机
  接受的短期风险。生产环境应改用固定出口、VPN、堡垒机或零信任入口。

### 5.3 防火墙与端口

腾讯云控制台防火墙在会话中确认过 5 条规则：SSH 22 允许全部 IPv4、HTTP 80
允许全部 IPv4、HTTPS 443 分别允许全部 IPv4/IPv6、ICMP Ping 允许。控制台
规则可能独立变化，执行安全变更前应重新读取实时配置。

Ubuntu UFW 当前：

- active，低级别日志开启。
- 默认拒绝入站、允许出站、拒绝 routed。
- 22/TCP 使用 `LIMIT IN`。
- 80/TCP、443/TCP 允许 IPv4/IPv6。

宿主机实际只监听公网 22、80、443。Web 3000、API 3001、PostgreSQL 5432
只存在于 Docker 内部网络；MinIO 9000/9001 未启动、未发布。

## 6. 当前云端发布状态

2026-09-01 10:20 CST 完成实时复核：

| 项目 | 状态 |
| --- | --- |
| 发布版本 | `17efe88-20260901020803` |
| 成功标记 | `2026-09-01T02:20:38Z` |
| 公网地址 | `http://115.159.50.166` |
| 健康接口 | `/api/health` 返回 `{"status":"ok"}` |
| Caddy | healthy，发布 80/443 |
| Web | healthy，仅内部 3000 |
| API | healthy，仅内部 3001 |
| PostgreSQL | healthy，仅内部 5432 |
| MinIO | 测试机按设计不启动 |

部署目录：`/srv/shanyu-erp`。主要服务器文件：

- `.env.production`：真实环境配置，权限 600；不得读取或输出其值。
- `.release.env`：当前 API/Web 镜像和 `RELEASE_VERSION`。
- `last-successful-deploy`：最近成功部署时间。
- `backups/`：本机 PostgreSQL 备份。

当前云端数据仍是 2026-08-31 的历史基线：未运行演示 seed；有一个 OWNER；
已发布 `半包报价单_v3.xlsx` 对应主材库内部 V1，共 8 分区、161 项，阻断 0 项。
用户已授权下一次测试发布直接重置该测试数据库，不做 OWNER→ADMIN 数据迁移；
重置后目标基线为一个 ADMIN、无 OWNER，再由 ADMIN 发布 V3 主材库 161 项。

## 7. 部署与运维实现

### 7.1 当前拓扑

```text
Internet → Caddy :80/:443 → Next.js Web / NestJS API → PostgreSQL
```

测试环境使用 IP + HTTP，`SESSION_COOKIE_SECURE=false`。生产必须使用域名 +
HTTPS，并设置 `SESSION_COOKIE_SECURE=true`。

### 7.2 脚本索引

| 脚本 | 作用 |
| --- | --- |
| `publish-from-mac.sh` | Mac 构建 amd64 镜像、上传文件和镜像、执行服务器部署 |
| `server-initialize-env.sh` | 首次生成服务器环境文件和 ADMIN 初始化配置 |
| `server-deploy.sh` | 使用服务器已有镜像执行备份、迁移、启动和健康检查 |
| `server-upgrade.sh` | 选择新镜像，升级前备份并保留上一版本 |
| `server-rollback.sh` | 切回上一组应用镜像，不执行数据库 down migration |
| `server-backup.sh` | 创建并验证 PostgreSQL 三件套备份 |
| `server-backup-to-cos.sh` | 仅在生产环境上传 COS、查询对象、回读复验并写入成功标记 |
| `server-verify-backup.sh` | 校验 SHA-256 和 `pg_restore --list` |
| `server-install-backup-timer.sh` | 安装 systemd 每日备份定时器 |
| `server-backup-and-clear-user-data.sh` | 备份成功后双重确认清空范围 A |
| `server-restore-backup.sh` | 安全备份当前库、双重确认恢复、失败自动回滚 |
| `migrate-backup-between-servers.sh` | 服务器之间迁移并双端验证备份，不自动恢复 |
| `verify-deployment-from-mac.sh` | 从 Mac 经 SSH 自检并通过公网 API 验证版本、ADMIN 登录、Session、用户列表和退出 |

详细参数和验收命令只以 `docs/operations/deployment.md` 为准。

## 8. 备份与恢复状态

### 8.1 已实现并验证

- PostgreSQL `pg_dump -Fc` 三件套：`.dump`、`.dump.meta`、`.dump.sha256`。
- SHA-256 同时覆盖 dump 和 meta，并验证 `pg_restore --list` 可读。
- 备份、清空、恢复共用互斥锁。
- 定时器每天 02:30 运行，本机保留 30 天。
- 清空范围 A 和恢复均要求真实 TTY 双重确认。
- 恢复前自动创建安全备份；恢复或数据量校验失败会自动回滚。
- 备份篡改、meta 篡改、错误计数、保留边界均已做故障注入测试。

2026-09-01 实时状态：

- `shanyu-erp-backup.timer` 为 active 且 enabled。
- 最近一次定时任务：2026-09-01 02:34:56 CST。
- 下一次计划：2026-09-02 约 02:32 CST（包含随机延迟）。
- 最近部署前后备份：
  - `shanyu-erp-20260901T022023-262477243Z.dump`
  - `shanyu-erp-20260901T022037-976198298Z.dump`

备份文件名是 UTC 时间，宿主机文件显示时间是 CST；判断先后时不要混淆。

### 8.2 生产 COS 链路与剩余门禁

COS 自动备份已接入统一 `server-backup.sh`：测试环境没有 COS，只执行
本机备份；生产环境必须完成 COS 上传、`stat`、回读和再次完整校验。
上传失败、回读损坏和环境模式错配置已通过故障注入测试。

目标链路：

```text
本机备份并验证
  → 上传私有 COS（dump → meta → sha256）
  → 检查对象
  → 回读临时目录
  → 再次执行 SHA-256 与 pg_restore 验证
  → 记录成功
  → 执行本机保留清理
```

当前生产配置使用最小前缀权限、HTTPS、SSE-COS、版本控制、本机 30 天和
COS 备份。仍未完成的生产门禁是：将新脚本发布后触发一次真实 systemd
备份、接入外部失败告警，以及从 COS 指定对象版本完成隔离恢复演练。
完整约束和验收命令见部署手册第 6、8、11 节。

## 9. 安全与数据 guardrails

- 服务器、数据库和云资源的修改必须先解析精确目标并备份。
- 生产数据清空只使用已测试的范围 A 脚本；恢复只使用恢复脚本。
- 让脚本自己执行双重确认；不增加环境变量或无交互旁路。
- 任何环境都不运行 `pnpm db:seed`。
- 数据库迁移只向前；镜像回滚不自动执行 schema down migration。
- 不手工删除 Docker volume，不使用 `docker compose down -v`。
- 不覆盖服务器已有 `.env.production`，不打印其中任何值。
- 不读取、复制或提交 SSH 私钥、ADMIN 密码、数据库密码、COS 密钥或 Token。
- 空库只初始化 ADMIN；已有 ADMIN 时不得修改其账号、显示名称或密码。
- 公网只暴露 Caddy 80/443 和 SSH 22。
- 对所有备份、清空和恢复保留日志、备份 ID、操作人、时间和验收结果。

## 10. 新 Ops 对话的优先队列

### P0：建立可追溯 Ops 基线

1. 重新检查脏工作区，区分 Ops 变更、业务变更和用户资料。
2. 审阅 Ops 相关 diff，不覆盖或夹带业务修改。
3. 运行质量门禁及部署脚本静态检查。
4. 将 Ops 交付形成独立、可审阅的 Git 提交并推送到 `origin/main`。
5. 按已确认口径重置旧 OWNER 测试库，用干净提交重新发布测试环境。
6. 运行 `verify-deployment-from-mac.sh`，记录 commit、镜像 tag、ADMIN 验收、
   部署时间和结果。

完成标准：测试服务器运行的镜像可以从唯一 Git 提交或 digest 重建。

### P1：完成 COS 生产实跑、告警和恢复演练

1. 将已通过故障注入测试的 COS 备份脚本发布到生产服务器。
2. 按部署手册 6.6 运行真实手工备份和 systemd 备份，保存 `.dump.cos` 证据。
3. 接入定时任务连续失败的外部告警并做一次真实通知演练。
4. 在隔离环境从 COS 指定对象版本完成真实恢复和业务数量校验。
5. 更新生产验收记录。

完成标准：从 COS 指定对象版本可恢复一个经过业务数量验证的环境；任一上传、
回读或校验错误都会阻断清理/清空/升级，并产生可定位告警。

### P2：生产部署流水线

1. CI 构建、测试并发布 amd64 不可变镜像。
2. 服务器使用只读拉取凭据，以 digest 部署。
3. 绑定正式域名、启用可信 HTTPS 和安全 Cookie。
4. 完成生产数据副本迁移、全量 V1 验收、容量测试和回滚演练。

完成标准：新生产环境可从仓库镜像和 COS 备份重复部署；域名切换前后均有
明确验收、回滚点和责任人。

### P3：后续生产能力

- 完成 ADR-0002 的业务对象存储迁移。它与 PostgreSQL COS 备份是不同工作。
- 建立日志、容量、磁盘、容器健康、备份失败和证书到期监控。
- 根据真实并发量决定生产 CPU、内存和磁盘，不沿用 2GB 测试机。

## 11. 每次任务的验收模板

每个 Ops 变更至少验证：

1. Git：目标文件明确，无夹带修改，`git diff --check` 通过。
2. 静态：Shell 语法/静态检查和 Compose 配置校验通过。
3. 应用：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 按风险执行。
4. 部署：四个核心容器 healthy，公网健康接口通过，内部端口未暴露。
5. 数据：迁移、备份和数量不变量通过；失败路径不会破坏现有数据。
6. 权限：SSH、sudo、密钥和服务端权限符合最小权限。
7. 浏览器：登录和本次受影响路径通过，不出现控制台错误。
8. 记录：更新部署手册、测试记录、版本映射、剩余风险和回滚方式。

## 12. 可直接发送给新对话的开场语

```text
这是山屿 ERP 的独立运维 Ops 对话。工作目录为：
/Users/xavier/Codex/山屿/shanyu_erp

请先完整阅读：
1. ~/.codex/AGENTS.md
2. AGENTS.md
3. docs/operations/OPS-HANDOFF.md

随后按 handoff 的“新对话启动指令”执行只读核查，保留全部现有修改，不要
重置、清理、提交或修改任何业务代码。先总结当前 Git、云服务器、部署、备份
与生产门禁状态，并给出本次 Ops 任务的计划和验收标准，得到我的目标后再执行。
```
