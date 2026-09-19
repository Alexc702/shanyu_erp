# 云端版本更新：固定发布清单与零影响主材更新

适用：**已有 V2 数据库（至少迁移 024，含导出队列表）**的测试、正式环境升级。
首次空库安装仍使用 `server-deploy.sh`；旧的三参数 `server-upgrade.sh` 调用已拒绝。
本方案在本地验证，不代表已经部署或验收任何云端环境。

## 1. 更新流程

1. 从已确认的干净 commit 制作 API/Web 镜像和配置包；镜像须有完整 commit 的
   `org.opencontainers.image.revision` 标签，架构为 `amd64`。构建时可使用
   `--label org.opencontainers.image.revision=<完整commit>`。镜像须包含本次新 CLI，
   配置包须包含 `scripts/deployment` 中的 `.sh` **和 `.py`** 文件。
2. 在隔离候选数据库执行迁移及本地回归，取得迁移后目标主材库 UUID 和内容哈希；
   确认迁移没有改写原账号、项目、历史报价。不要用原始 Excel 文件 SHA 代替内容哈希。
3. 分别生成测试、生产发布清单，核对主机身份、当前版本、目标镜像 ID、持久卷。
   用户每次明确确认目标环境、版本和维护窗口后，才上传包、加载镜像、执行升级。
4. 升级脚本获取与备份/恢复共用的 `flock`，检查环境和镜像及脚本能力；校验新
   Compose 持久卷映射和内部端口未公开。不同终端的升级不能并发运行。
5. 进入维护窗口：停止 Caddy、Web、API 和导出 worker，保持 PostgreSQL 不动。
   这是有计划停机（公网暂不可连接），不是无感升级或 503 页面。
   仍有其他数据库连接或 PENDING/RUNNING 导出任务则停止；**不杀连接、不清队列**。
   应提前让导出队列空闲，避免中断正在导出的任务。
6. 创建并校验部署前备份；测试必须 local，生产必须 COS 上传及回读通过。
   使用候选镜像的只读 CLI 记录 13 张业务表逐行 SHA-256、数量和原列集合。
7. 保存旧镜像选择与配置，选择候选版本，仅执行向前迁移；按原列验证业务数据完全未变。
   新增列不参与旧数据指纹，已存在列发生回填/变化也会阻断，不能默默接受。
8. 固定 UUID + 主材业务内容哈希执行 dry-run，先落盘并验证完整 JSON；再将预览的
   planHash 传入 apply。在同一个更新事务内锁库/报价/选型、重新分析；任何漂移回滚
   整个安全更新事务。BLOCKED/PROTECTED 是正常跳过，不是部署技术失败。
9. 比较全量业务基线，只放行报告中 UPDATED 报价的库引用、行引用、revision+1、
   更新时间，以及对应新增审计。账号、凭据、会话、项目、空间、半包、审批、导出和
   其他报价必须逐行不变；不得减少或凭空新增。
10. 创建、校验部署后备份；检查 `.env.production` 内容指纹、权限与属主未变。
11. 启动新 API/Web、卷权限初始化和 worker；验证命名卷、UID 1000 可写；再打开 Caddy，
    检查公网健康及全部服务健康、无 OOM、worker 重启数为 0。更新运维脚本并归档成功。
    公网恢复发生在最后健康检查阶段，因此用户恢复访问后的正常业务写入不属于停机基线。

主材规则保持不变：只更新零影响的首次编辑草稿；任何有历史血缘的版本及其派生草稿
永久排除自动更新。每个报价整单判断，不自动清空选型或重算价格/数量/折扣。

## 2. 发布清单（每个环境各一份）

下面是结构示例，尖括号必须由本次真实证据替换，**不能原样执行**：

```json
{
  "schema": 1,
  "environment": "test",
  "origin": "http://115.159.50.166",
  "machineId": "<目标主机/etc/machine-id的32位值>",
  "previousRelease": "<只读核实的当前RELEASE_VERSION>",
  "release": "<本次RELEASE_VERSION>",
  "commit": "<40位commit>",
  "api": {"ref": "shanyu-erp-api:<本次RELEASE_VERSION>", "id": "sha256:<64位镜像ID>"},
  "web": {"ref": "shanyu-erp-web:<本次RELEASE_VERSION>", "id": "sha256:<64位镜像ID>"},
  "catalog": {"id": "<迁移后预期的已发布主材库UUID>", "sha256": "<64位业务内容哈希>"},
  "postgresVolume": "<实测PostgreSQL命名卷>",
  "exportsVolume": "<实测quotation_exports命名卷>"
}
```

生产清单使用 `environment=production`、`origin=https://shanyuerp.art`，以及生产自己的
machineId、previousRelease 和卷名；不可复制测试环境的身份字段。
正式 SSH 使用用户已确认的 `shanyu-erp-prod`（124.223.104.225），不是旧交接别名。

内容哈希包含目标库全部商品的业务字段、精确价格字符串和排序后的图片关联，排除
导入行号等来源元数据及每次导入新生成的 item UUID。由已构建 API 的 CLI 生成：

```bash
# 仅在隔离的本地发布候选库，安全注入 POSTGRES_* 环境变量；不在命令写真实口令。
cd /Users/lulu/Codex/山屿/shanyu_erp/apps/api
umask 077
node scripts/reconcile-main-material-drafts.mjs --dry-run --environment=local \
  --target=<候选库UUID> > /private/tmp/shanyu-catalog-release-preview.json
```

使用报告 `targetCatalogId` 与 `targetCatalogHash` 填清单；`planHash` 则必须在实际云端
停写后的预览重新生成，不能把本地计划用于云端。没更新库的应用版本也必须固定该环境
经审核的当前库。如果库由在线导入产生、不同环境 UUID 不同，应分别审核清单，不得在
部署时“查询最新发布库并无条件采用”，也不得遇到哈希不符就把清单改成现场值绕过门禁。

## 3. 可以交给 Codex 的每次发布指令

复制下面整段；每次只选择**一个环境**，补齐版本、commit、包路径及 SHA-256。
清单可由 Codex 基于上述证据生成，但必须先报告再取得当次确认。

```text
执行山屿 ERP 已有云端环境版本更新，严格遵循
shanyu_erp/docs/operations/guarded-version-upgrade.md。

本次环境：<test 或 production，只选一个>
RELEASE_VERSION：<版本>
commit：<完整40位提交>
现成镜像包：<路径>；SHA-256：<哈希>
现成配置包：<路径>；SHA-256：<哈希>
发布清单：<release-test.json 或 release-production.json 的绝对路径>

test 仅连接 shanyu-erp-test / 115.159.50.166 / http://115.159.50.166；local 备份，无 COS。
production 仅连接 shanyu-erp-prod / 124.223.104.225 / https://shanyuerp.art；production+cos。
不得连接另一个环境。SSH 使用 BatchMode=yes、StrictHostKeyChecking=yes；不接受未知指纹。

完整阅读 AGENTS.md、部署手册、云端交接和 guarded-version-upgrade.md。
保留全部本地改动，不自行 stage/commit/push；禁止从脏工作区重新打包冒充目标 commit。
只读核对目标服务器身份、当前版本、持久卷、全部账号和项目、磁盘、备份和 timer；
核对清单 machineId/previousRelease、镜像 ID/架构/revision、目标库 UUID 与内容哈希。
报告精确目标、证据、备份、维护窗口风险及验收标准，取得我本次明确确认再继续。

本地校验包 SHA-256；上传到该环境 /srv/shanyu-erp/releases/<版本>/ 的独立 staging，
已存在非空目录先核对，不覆盖不同内容。远端再次校验包 SHA-256。
检查 tar 清单没有绝对路径、.. 跳出、符号/硬链接、.env.production、备份或数据卷内容，
只将配置包解到该 staging；不要直接覆盖 /srv/shanyu-erp 中的运行配置。
docker load 加载已验证的现成镜像，禁止 docker build / pull；再次核对镜像 revision 和 ID。
保存清单为 staging/release-<环境>.json（0600），配置包保持标准相对目录结构：
compose.prod.yaml、Caddyfile、scripts/deployment/*.sh/*.py。
从 staging 调用 server-upgrade.sh，两个参数分别为清单绝对路径、环境:发布版本。

不覆盖 .env.production；保留所有账号、凭据、项目、历史/当前报价、审批、导出和审计。
不导入任何迁移副本，不 seed、清库、restore、down -v、删除数据卷或旧备份。
不手工绕过 UUID/hash/数据基线/维护标记。失败立即停止，报告失败阶段；未经另行授权
不恢复数据库、不自动启动旧镜像、不删除 .upgrade-maintenance。

运行后读取私有 deployment-reports 对应目录，汇总（不输出成本、凭据或逐行敏感值）：
实际版本/commit/镜像ID、迁移日志、前后数据数量、preview/apply 更新及跳过原因、
备份三件套校验（生产须COS回读）、卷、容器健康/重启/OOM及公网健康结果。
再用授权会话验收项目报价读取、主材选型读取及 XLSX/PDF 队列导出；只允许新增导出及
其必要任务/审计记录，不改原报价。下载非空、文件类型和数据库 SHA-256 必须一致。
没有授权会话时如实报告该项待人工验收，禁止重置密码或凭空宣称业务验收通过。
最终分别说明自动部署门禁与业务烟雾验收结果，并确认未操作另一环境。
```

## 4. 核心执行命令

以下是在**上述 staging/清单/镜像都准备好且用户已确认后**执行的命令。
不是把现有旧镜像包直接交给新脚本：旧包不含新能力会拒绝。

```bash
# 替换为本次已确认版本；只运行所选环境的一条 SSH 命令。
RELEASE='<本次RELEASE_VERSION>'

# 测试
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes shanyu-erp-test \
  "bash /srv/shanyu-erp/releases/$RELEASE/scripts/deployment/server-upgrade.sh /srv/shanyu-erp/releases/$RELEASE/release-test.json test:$RELEASE"

# 正式（独立确认后执行；不是紧随测试自动连带发布）
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes shanyu-erp-prod \
  "bash /srv/shanyu-erp/releases/$RELEASE/scripts/deployment/server-upgrade.sh /srv/shanyu-erp/releases/$RELEASE/release-production.json production:$RELEASE"
```

同一成功版本可以重复执行：重新备份、预览和校验；已更新草稿不会重复增加 revision
或审计，`.release.previous.env` 不被本版本覆盖。不要无审核重新标记同名镜像。

## 5. 报告、失败与真实验收边界

- 报告在 `/srv/shanyu-erp/deployment-reports/<release>.<随机ID>/`，目录 0700、
  文件默认 0600。包括清单、旧配置、before/after、preview/apply、迁移/健康/错误日志、
  前后备份路径和 status；报告可能含成本，不挂到 Web、不公开上传或贴到聊天。
- `.upgrade-maintenance` 保存本次报告目录。失败会再次停止 Caddy/Web/API/worker，
  保留 PostgreSQL、卷、备份、报告和标记；后续升级自动拒绝。
- **迁移和安全更新是两个事务阶段**。迁移工具可能还逐文件提交；任意失败都要查看
  `schema_migrations` 与日志，不能把“更新事务回滚”说成“整个部署回滚”。
- apply 已成功但写报告/健康检查失败时，数据库可能已经提交；COMMIT 响应丢失也可能
  造成提交结果不确定。只能先只读核查。没有自动恢复整个数据库或自动重启旧镜像。
- 人工排障后，要继续/回滚镜像必须重新确认 schema 兼容、现场数据和新备份，明确授权
  后才处理维护标记。旧 `server-rollback.sh` 也要求兼容性确认且拒绝未解决维护状态。
- 环境自检脚本的 `server` profile 仍要求 MinIO；实际生产 COS 数据库备份不等于 MinIO。
  不为了让旧 profile 通过而启动未批准的对象存储。以本升级门禁及实际业务验收为准，
  单独记录已有自检 profile 与部署拓扑不一致项。
- 此次自动门禁不伪造登录、不创建业务报价、不调用导出 API。真实 XLSX/PDF 业务烟雾、
  COS 定时任务触发/告警/隔离恢复演练仍需目标环境的真实验收；备份 `pg_restore --list`
  可读不等于已完成恢复演练。
- 普通发布不升级 PostgreSQL 大版本，不改变持久卷。此类基础设施变更以及会修改旧业务
  字段的数据迁移必须独立审核和演练，不属于“每版直接执行”的自动放行范围。
