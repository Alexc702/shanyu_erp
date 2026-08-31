# 山屿 ERP 数据持久化：官方资料研究结论

> 调研日期：2026-08-31  
> 范围：PostgreSQL、Amazon S3、Docker 官方资料。本文记录技术能力、约束和对本项目的架构推论，不展开数据库表设计，也不替代后续实施方案与恢复手册。

## 结论摘要

山屿 ERP 至少三年的持久化基线应采用三层职责：

- **PostgreSQL 18** 是项目、报价版本、审批、施工、财务和审计等结构化业务事实的唯一权威来源；核心关系和金额使用关系模型及数据库约束，JSONB 只承载边界明确的快照或扩展数据。
- **S3 兼容对象存储** 保存主材照片、施工照片、合同/附件及已生成的 PDF、Excel；业务代码只依赖 S3 接口，不依赖宿主机文件路径。对象必须具备稳定业务身份和内容校验值，不能把某一家存储服务生成的版本 ID 当成跨平台身份。
- **Docker 命名卷** 只解决容器重建后的本机数据保留，不是备份。生产数据库使用 PostgreSQL 原生基础备份、连续 WAL 和 PITR；数据库、对象与运行配置均另存到服务器之外，并以实际恢复演练作为有效性标准。

当前官方稳定主版本为 PostgreSQL 18。官方支持策略显示 PostgreSQL 18.6 支持至 2030-11-14，能够覆盖从当前起至少三年的运行窗口；官方也建议始终运行所选主版本的最新次要版本。[PostgreSQL 版本策略](https://www.postgresql.org/support/versioning/)

## 1. 长期业务数据的持久化要求

以下是结合一期报价和后续施工、财务阶段得出的项目要求：

1. 项目 ID、空间 ID、主材/工程项版本及已批准报价版本必须长期稳定引用；主材库调价不得回写历史报价。
2. 报价从“草稿”变为“发布/批准”时，版本、明细、计价结果、批准信息和审计事件必须原子提交。PostgreSQL 事务保证一组操作全部成功或全部失败，并在提交前不向其他事务暴露中间状态。[PostgreSQL 事务](https://www.postgresql.org/docs/current/tutorial-transactions.html)
3. 已发布或已批准报价不得原地修改或物理删除；纠错必须形成新版本。二期施工只消费批准基准并追加工程变动，三期财务使用更正/冲销记录，不覆盖原交易事实。
4. 审计记录必须与业务变更在同一数据库事务内追加，覆盖操作者、动作、业务对象、变更前后上下文、请求关联和发生时间。生产应用账号应为非数据库所有者、非超级用户，并对历史版本和审计数据撤销 UPDATE、DELETE、TRUNCATE 权限。PostgreSQL 可分别授予或撤销这些权限，但对象所有者和超级用户仍有更高能力，因此单库审计不能宣称具备对管理员的绝对防篡改能力。[PostgreSQL 权限](https://www.postgresql.org/docs/current/ddl-priv.html)
5. 金额、单价、成本、折扣和利润必须采用精确十进制语义，不能使用浮点数。PostgreSQL 官方将 `numeric` 描述为精确类型，并特别推荐用于金额；`real` 和 `double precision` 是不精确类型。[PostgreSQL 数值类型](https://www.postgresql.org/docs/current/datatype-numeric.html)
6. 业务记录至少保留三年；批准报价、审批、审计、施工证据、合同和财务凭证默认不设自动到期。最终保留期仍需老板结合合同、财税和争议处理要求确认，不能仅以“三年”为所有数据的法定上限。

## 2. PostgreSQL 数据完整性边界

### 2.1 关系约束优先

核心身份、状态、金额、时间和跨模块引用应关系化，并使用 NOT NULL、CHECK、UNIQUE、PRIMARY KEY、FOREIGN KEY 等约束防止非法状态进入数据库。官方说明约束违规会直接报错；同时，CHECK 不应依赖其他行或其他表，跨行/跨表规则应优先使用 UNIQUE、EXCLUDE、FOREIGN KEY，剩余规则再由事务或受控触发器实现。[PostgreSQL 约束](https://www.postgresql.org/docs/current/ddl-constraints.html)

对本项目的直接推论是：

- 报价号和版本序号必须避免重复；明细必须稳定属于某个具体版本。
- 批准版本要保存当时用于计算的工程项/材料描述、单位、售价、成本、计价规则和合计结果，不能只引用主材库“当前值”。
- 审批发布、版本快照、项目当前批准版本指向及审计事件必须处于同一显式事务。
- 高并发审批或财务过账需要检测并发修改并完整重试，避免后写覆盖先写。PostgreSQL 默认 Read Committed 是语句级快照；Repeatable Read 提供事务级稳定快照；Serializable 可排除序列化异常，但应用必须重试序列化失败的完整事务。[PostgreSQL 事务隔离](https://www.postgresql.org/docs/current/transaction-iso.html)

### 2.2 JSONB 只用于受控扩展与快照

PostgreSQL 官方通常建议 JSON 场景使用 JSONB，因为它处理更快且支持索引；但官方同时建议 JSON 文档仍保持相对固定结构，并指出更新 JSON 会锁住整行。[PostgreSQL JSON 类型](https://www.postgresql.org/docs/current/datatype-json.html)

因此本项目不采用“所有业务都塞进 JSON”的模式。JSONB 可用于低频扩展属性、导入原文、审批上下文、审计变更内容或不可变快照；项目、报价、版本、状态、金额、成本、日期和外键等需要约束、统计、检索的事实仍使用关系字段。只有出现明确查询路径时才增加 JSONB 索引。

### 2.3 不可变不是 PostgreSQL 的单一开关

PostgreSQL 提供行级/语句级触发器，可读取 UPDATE、DELETE 的旧值和新值，适合自动追加审计或拒绝已发布版本被改写。[PostgreSQL 触发器行为](https://www.postgresql.org/docs/current/trigger-definition.html)

本项目的“报价不可变”应由以下措施叠加实现：应用状态机禁止修改、批准时生成独立快照、数据库权限限制历史写入、数据库约束/触发器兜底、异机备份提供恢复能力。若未来需要合规级 WORM 或对数据库管理员也不可抵赖的证据，还需把关键导出和审计摘要写入独立的不可变存储；不能只依赖同一 PostgreSQL 实例。

## 3. PostgreSQL 备份、PITR 与恢复要求

### 3.1 两类备份各司其职

生产主保护应是 **基础备份 + 连续 WAL 归档**。PostgreSQL 官方说明，基础备份与连续 WAL 可以把整个数据库集群恢复到基础备份之后的指定时间点；恢复所需 WAL 必须保持连续。[PostgreSQL 连续归档与 PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)

`pg_dump` 能在数据库并发使用时产生一致导出，归档格式可通过 `pg_restore` 选择性或并行恢复，也适合跨机器、跨架构及向较新 PostgreSQL 版本迁移；但官方明确指出，除简单情况外，`pg_dump` 通常不应成为生产数据库唯一的常规备份。[pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)

建议的项目基线（频率是本项目方案，不是 PostgreSQL 官方固定要求）：

- 连续归档 WAL，并至少每日生成一次完整基础备份；保留可组成连续恢复链的基础备份、WAL 和时间线文件 35 天。
- 每日生成一份 `pg_dump` 自定义格式逻辑备份作为可移植第二层；日备保留 35 天，月末备份保留 36 个月。
- 数据库角色等集群全局对象单独导出或由基础设施配置重建；`postgresql.conf`、`pg_hba.conf` 等配置单独版本化和备份，因为 WAL 不会恢复手工编辑的配置文件。[PITR 对配置文件的限制](https://www.postgresql.org/docs/current/continuous-archiving.html)
- 所有生产备份加密并保存到生产服务器之外；备份任务失败、WAL 归档积压、目标存储不可用和容量不足必须告警。官方特别提示 WAL 归档长期失败会令 `pg_wal` 持续增长，最终可能使数据库停机。
- 初期生产目标设为 RPO 不超过 15 分钟、RTO 不超过 4 小时；上线前用实测恢复时间确认，数据量或业务重要性增长后重新评估。

### 3.2 校验不等于可恢复

`pg_basebackup` 默认生成备份清单，`pg_verifybackup` 可检查文件、校验和以及恢复所需 WAL 范围；官方明确说明该校验不能覆盖服务器实际恢复时的全部检查，即使校验通过也仍需测试恢复并核对数据。[pg_verifybackup](https://www.postgresql.org/docs/current/app-pgverifybackup.html)

因此要求：

- 每次基础备份完成后自动执行完整性校验并记录结果。
- 至少每季度在隔离环境完成一次 PostgreSQL PITR、逻辑备份恢复和对象恢复；验证登录、项目数量、批准报价金额、附件可打开和审计链可追溯。
- 数据库主版本升级、存储迁移或重大 schema migration 前额外执行一次完整恢复演练。
- 只生成备份文件但从未恢复过，不计为已验证的备份能力。

## 4. 照片、附件与导出文件的对象存储要求

### 4.1 对象与数据库的职责分离

照片、PPT/PDF、合同、Excel 和导出文件存入 S3 兼容对象存储；PostgreSQL 只保存业务归属、对象位置、内容类型、大小、内容校验值和生命周期状态等元数据。数据库中不能保存宿主机绝对路径。

对象键应一次生成后不复用；更新文件应创建新对象/新业务版本。数据库和对象存储无法共享一个本地 ACID 事务，因此写入顺序应为“上传对象并校验成功，再提交数据库引用”；失败上传或事务回滚产生的孤立对象由定时核对安全清理。删除则先做业务层逻辑删除，满足保留期并完成引用检查后才物理清理。

### 4.2 版本、生命周期与完整性

- S3 Versioning 会为同一对象键保留多个版本；普通删除会写入删除标记，覆盖会产生新版本，因而可恢复误删或误覆盖。[S3 Versioning 工作方式](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html)
- Lifecycle 可把当前或非当前版本转移到更低成本存储层，也可过期删除。对版本化桶，删除当前版本与永久删除非当前版本是不同动作；规则配置错误会永久删除历史版本。[S3 Lifecycle 规则](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)
- S3 支持上传、下载时使用 checksum 验证内容完整性。[S3 对象完整性校验](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html)
- Object Lock 在启用 Versioning 的桶上提供保留期或法律保留，可按 WORM 方式阻止指定对象版本被覆盖/删除；它适合确有不可变要求的批准报价导出、合同或审计归档，但启用前必须确认所选 S3 兼容实现对相关 API 和语义的真实支持。[S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)

对本项目的最低要求是：本地和生产对象桶均启用版本控制；上传时计算并保存 SHA-256 等稳定内容摘要，迁移或恢复后逐对象抽查/批量比对；按“业务原件/批准导出”“施工证据”“临时导出”分层配置生命周期，不对所有文件套用同一个过期规则。S3 版本 ID 可以作为后端辅助信息，但不能作为跨 MinIO、云 S3 和迁移目标保持不变的业务 ID。

### 4.3 版本控制不是异机备份

同一服务器、同一管理员权限域中的版本仍可能随磁盘、主机或凭证事故一起丢失。AWS 官方将 Versioning、Object Lock 和跨区域复制列为不同的数据保护手段，并指出复制需要源、目标桶都启用版本控制。[S3 安全最佳实践](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)

生产 MinIO/对象存储因此必须定期镜像或备份到另一台机器或独立云对象桶；远端副本使用独立凭证和最小权限。若当前 S3 兼容实现不支持 AWS Replication/Object Lock，不应假设其具备相同保证，而应采用已验证的厂商备份/镜像能力并执行恢复测试。

## 5. Docker Compose 与持久卷的正确边界

Docker 官方说明，volume 是由容器引擎管理的持久数据存储；命名卷在容器删除后仍可保留，也支持备份、恢复和迁移。[Docker volumes](https://docs.docker.com/engine/storage/volumes/)

Compose 的顶层命名卷可以由多个服务复用；标记为 `external` 后，其生命周期由 Compose 项目之外管理，Compose 不负责创建，缺失时会报错。[Compose volumes](https://docs.docker.com/reference/compose-file/volumes/)

本项目据此采用：

- 本地开发使用有明确名称的 PostgreSQL 和 MinIO 命名卷，确保普通容器重建不清空数据。
- 生产卷使用独立、显式命名并由部署流程管理；不得把匿名卷当作长期数据位置，也不得在常规发布脚本中使用 `docker compose down -v` 或 `docker volume prune`。
- 卷只是运行副本，备份必须输出到卷和宿主机之外。Docker 文档中的 tar 卷示例是通用机制；对运行中的 PostgreSQL，直接打包数据卷不能替代数据库一致性备份。PostgreSQL 官方指出普通文件系统级备份通常要求数据库关闭，或采用一致快照/连续归档方案。[PostgreSQL 文件系统级备份](https://www.postgresql.org/docs/current/backup-file.html)
- MinIO 数据卷也不应在持续写入时仅靠任意 tar 复制宣称可恢复；应使用该实现官方支持的备份/复制方式，并同时保留对象清单、校验结果和恢复演练证据。

## 6. 从本地部署迁移到服务器

第一次从 macOS 本地环境迁移到 Linux 服务器时，推荐流程为：

1. 服务器使用与本地一致或更高的受支持 PostgreSQL 主版本，先部署空数据库并执行同一套有序 schema migration。
2. 在短暂停写窗口生成 `pg_dump` 自定义格式备份，在服务器用 `pg_restore` 恢复。官方说明归档格式可跨架构，且 dump 通常可装载到较新版本；`pg_dump` 客户端不能导出比自身主版本更新的服务器，因此迁移工具版本必须不低于源数据库。[pg_dump 兼容性](https://www.postgresql.org/docs/current/app-pgdump.html)
3. 通过 S3 API 复制对象，逐对象比对稳定内容校验值；不能要求目标存储继承源存储生成的版本 ID。
4. 执行迁移校验：核心实体计数、批准报价关键金额、版本链、审计事件、附件可读性和随机内容摘要。
5. 切换前保留源环境只读副本；切换后完成一轮服务器端基础备份、WAL 归档、异机对象备份和实际恢复演练，再释放源环境。

此流程不通过复制 Docker volume 完成跨平台迁移，避免把容器运行时布局、CPU 架构或文件系统差异带入业务迁移。

## 7. 三年升级与迁移生命周期

- PostgreSQL 18 主版本固定在部署配置中，并持续升级到最新 18.x 次要版本；次要版本先在恢复出的测试库完成应用回归，再安排维护窗上线。
- 所有 schema 变更必须来自版本库中的有序 migration，禁止只在生产手工改表；破坏性变更使用“先扩展、回填、切换、最后收缩”的分阶段方式，保证近期 PRD 和设计稿反复调整时仍可前滚升级。
- 主版本升级可使用 dump/restore 或 `pg_upgrade`。官方版本策略说明主版本可能改变内部格式，必须执行相应迁移；`pg_upgrade` 提供 `--check` 检查，但扩展和二进制兼容仍需确认。[PostgreSQL 升级说明](https://www.postgresql.org/docs/current/upgrading.html) [pg_upgrade](https://www.postgresql.org/docs/current/pgupgrade.html)
- PostgreSQL 18 的官方支持到 2030-11-14，应在 2029 年启动下一主版本的兼容性测试和迁移计划，避免把升级推迟到停止支持之后。
- 每次数据迁移都必须生成可复现报告，包括源/目标版本、起止时间、记录/对象校验、失败项、回退点和审批人；迁移完成不等于可以立即删除旧备份。

## 8. 可直接进入技术方案的验收条件

1. 重建 Web/API 容器不会丢失 PostgreSQL 或对象数据；误删持久卷时可从异机备份恢复。
2. 任一报价批准操作要么完整生成批准版本与审计记录，要么完全不生效；批准版本无法通过普通应用账号原地修改或删除。
3. 主材调价后，历史批准报价及其 PDF/Excel 仍复现原金额和原材料描述。
4. 可将生产 PostgreSQL 恢复到最近 35 天内指定时间点，并在目标 RTO 内完成业务校验。
5. 任一附件能通过数据库业务关系定位；迁移后内容校验值一致；对象误覆盖或误删可从版本或异机副本恢复。
6. 每季度恢复演练同时覆盖数据库、对象、配置与应用迁移，不只验证备份文件存在。
7. 当前 PostgreSQL 主版本处于官方支持期，最新次要版本升级和下一主版本迁移有明确负责人、时间窗和回退方案。

## 官方资料索引

- PostgreSQL：[版本策略](https://www.postgresql.org/support/versioning/)、[事务](https://www.postgresql.org/docs/current/tutorial-transactions.html)、[隔离级别](https://www.postgresql.org/docs/current/transaction-iso.html)、[约束](https://www.postgresql.org/docs/current/ddl-constraints.html)、[JSONB](https://www.postgresql.org/docs/current/datatype-json.html)、[PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)、[pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)、[pg_verifybackup](https://www.postgresql.org/docs/current/app-pgverifybackup.html)、[升级](https://www.postgresql.org/docs/current/upgrading.html)。
- Amazon S3：[Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html)、[Lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)、[完整性校验](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html)、[Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)、[安全最佳实践](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)。
- Docker：[Volumes](https://docs.docker.com/engine/storage/volumes/)、[Compose Volumes](https://docs.docker.com/reference/compose-file/volumes/)。
