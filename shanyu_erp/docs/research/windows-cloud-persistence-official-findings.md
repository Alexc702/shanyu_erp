# 山屿 ERP：Windows 云服务器、云基础设施与数据持久化责任边界

> 调研日期：2026-08-31  
> 范围：Microsoft、PostgreSQL、AWS、Alibaba Cloud 官方资料。云厂商尚未确定，因此本文区分通用结论与厂商示例，不把任何一家厂商的能力默认套用到另一家。

## 结论摘要

1. “通用云 Windows Server + Hyper-V + Ubuntu VM”是一个**有前置条件的方案**，不是供应商无关的默认方案。Windows Server 运行在云 VM 内时，再启用 Hyper-V 属于嵌套虚拟化；必须在购买前确认具体云厂商、地域、实例规格和 Windows 授权明确支持。不同厂商差异很大：AWS 仅列出部分 EC2 规格支持 Hyper-V/KVM 嵌套虚拟化；Alibaba Cloud 官方限制则是只有 ECS 裸金属实例和 SCC 支持二次虚拟化。[AWS 嵌套虚拟化](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html) [Alibaba Cloud ECS 限制](https://www.alibabacloud.com/help/en/ecs/user-guide/limitations)
2. 如果 Windows Server 没有独立业务用途，供应商未定时更简单、故障面更小的默认方案是**直接购买 Ubuntu LTS 云 VM**，不增加 Windows 和第二层 Hyper-V。若云厂商提供满足要求的托管 PostgreSQL 和对象存储，生产数据层优先考虑托管服务；应用容器只运行在 Linux VM。
3. 云盘或整机快照主要保护“某一时刻的磁盘/VM 状态”，默认通常只有崩溃一致性；它不等于 PostgreSQL 的应用一致备份，更不等于连续 WAL/PITR。PostgreSQL 仍需独立的基础备份、连续 WAL、逻辑备份和恢复演练。[PostgreSQL PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
4. 高可用、副本、快照和备份是不同能力。高可用副本会同步错误操作；Azure 托管 PostgreSQL 官方也明确指出误删表或错误更新会复制到备用节点，必须通过 PITR 从备份恢复。[Azure Database for PostgreSQL 高可用](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-high-availability)
5. 无论选择 IaaS 还是托管服务，山屿仍始终负责数据含义、身份与权限、报价不可变版本、审计、保留策略、备份策略选择和恢复验收。云厂商的硬件冗余或“自动备份已开启”不转移这些责任。[Microsoft 云共享责任](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility)

## 1. 通用责任边界

Microsoft 官方的共享责任模型指出：IaaS 中客户负责 VM、操作系统和应用；PaaS 中供应商接管操作系统和平台，但客户在所有模式下仍拥有并负责自己的数据、身份、配置和访问控制。[Microsoft 云共享责任](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility)

据此，本项目的责任边界如下：

| 层级 | 云厂商负责 | 山屿 / 项目团队负责 |
| --- | --- | --- |
| 物理基础设施 | 数据中心、物理主机、底层网络和云平台虚拟化层 | 选择地域、可用区、产品规格和服务等级，并验证所购服务的实际能力 |
| Windows / Ubuntu IaaS | 提供 VM 和云盘服务 | Windows、Hyper-V、Ubuntu、Docker、补丁、加固、容量、监控、故障处理和恢复 |
| 托管 PostgreSQL / 对象存储 | 按产品约定管理平台、引擎、底层冗余和已启用的备份/高可用功能 | 数据模型、账号权限、参数与保留期选择、迁移、逻辑导出、跨域副本、告警和恢复验收 |
| ERP 应用 | 无 | 报价版本不可变、审计、金额一致性、对象引用与校验、业务保留期、schema migration 和恢复后的业务核对 |
| 备份与灾备 | 提供快照、复制、备份库等可选能力 | 明确 RPO/RTO，启用并监控策略，隔离权限与密钥，执行定期恢复演练 |

AWS 和 Alibaba Cloud 的官方共享责任说明同样把 EC2/ECS 客户机的操作系统补丁、应用、访问控制和数据保护配置留给客户；云厂商负责底层基础设施。[AWS 共享责任](https://docs.aws.amazon.com/whitepapers/latest/aws-risk-and-compliance/shared-responsibility-model.html) [Alibaba Cloud ECS 共享责任](https://www.alibabacloud.com/help/en/ecs/user-guide/ecs-shared-responsibility-model)

## 2. Windows Server + Hyper-V + Ubuntu VM 的适用条件

### 2.1 技术上可行，但云 VM 场景属于嵌套虚拟化

Microsoft 支持在 Hyper-V 上运行 Ubuntu 24.04 LTS、22.04 LTS 等版本，并提供相应集成服务能力说明。[Hyper-V 支持的 Ubuntu VM](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/supported-ubuntu-virtual-machines-on-hyper-v)

若 Windows Server 是物理服务器，需满足 Hyper-V 对 64 位处理器、SLAT、硬件虚拟化扩展和内存的要求。[安装 Hyper-V](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/Install-Hyper-V)

若 Windows Server 自身是云厂商创建的虚拟机，再在其中运行 Ubuntu，就是 L0 云平台 → L1 Windows/Hyper-V → L2 Ubuntu 的嵌套结构。Microsoft 明确提示嵌套虚拟化会增加网络、内存、CPU 兼容性和性能方面的复杂性，并建议生产环境除非确有需要不要启用嵌套。[Microsoft Hyper-V 嵌套虚拟化排障与条件](https://learn.microsoft.com/en-us/troubleshoot/windows-server/high-availability/hyper-v-nested-virtualization) [Hyper-V 安全规划](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/plan/plan-hyper-v-security-in-windows-server)

### 2.2 供应商未定时不能先假设可用

官方资料展示了明显的厂商差异：

- AWS 当前仅对列出的 C/M/R/I 等部分实例系列开放嵌套虚拟化，支持的 L1 hypervisor 为 KVM 和 Hyper-V；Windows 场景还有 Credential Guard、休眠和 CPU 等限制。[AWS EC2 嵌套虚拟化](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html)
- Alibaba Cloud 官方写明只有 ECS Bare Metal Instance 和 SCC 支持二次虚拟化，其他实例系列不支持安装虚拟化软件或二次虚拟化。[Alibaba Cloud ECS 限制](https://www.alibabacloud.com/help/en/ecs/user-guide/limitations)
- Microsoft 的嵌套 Hyper-V 前提包括外层 VM 暴露处理器虚拟化扩展；Azure 还必须选择明确支持嵌套虚拟化的 VM 规格，不代表任意“Windows 云服务器”都能安装 Hyper-V。[Microsoft 启用嵌套虚拟化](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/enable-nested-virtualization)

因此采购前必须取得可验证答案：具体地域和实例 SKU 是否暴露 VT-x/AMD-V、是否支持 Hyper-V、是否允许生产使用、迁移/变配后是否仍支持、Windows 授权如何计算，以及云备份是否能识别嵌套 Ubuntu 中的工作负载。只看到“支持 Windows Server”不能推导出“支持 Hyper-V”。

### 2.3 对山屿 ERP 的选择顺序

1. **首选：直接 Ubuntu LTS VM。** Windows 没有独立业务需求时，少一层 OS、hypervisor、网络和补丁责任。
2. **条件选择：Windows Server + Hyper-V + Ubuntu。** 仅当 Windows Server 还承载必须保留的 Windows 工作负载，且所购云规格明确支持嵌套虚拟化时采用。ERP 仍只运行在 Ubuntu 内，不在 Windows 上混跑另一套数据目录。
3. **不接受：先购买普通 Windows 云 VM，再尝试安装 Hyper-V。** 这会把能否部署变成采购后的兼容性风险。

无论选哪一种，Windows/Hyper-V 的 checkpoint、Ubuntu VM 快照都不是 PostgreSQL 长期备份策略的替代品。

## 3. 云盘/实例快照与 PostgreSQL PITR 的区别

### 3.1 快照的一致性等级

云盘快照通常复制某时刻的存储块。Azure 官方把 Azure Disk Backup 定义为基于增量快照的**崩溃一致**备份；如果需要应用一致的整机和数据盘备份，应使用具有相应协调能力的 VM Backup。[Azure 磁盘备份与灾备](https://learn.microsoft.com/en-us/azure/virtual-machines/backup-and-disaster-recovery-for-azure-iaas-disks)

AWS 的多卷 CreateSnapshots API 生成同一实例各卷之间的崩溃一致快照；针对自建 PostgreSQL 等数据库，AWS 要求通过 pre/post scripts 正确冻结、刷新和恢复 I/O，只有脚本成功时才能保证应用一致性，而且正确脚本属于客户责任。[AWS 多卷快照 API](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSnapshots.html) [AWS 应用一致快照](https://docs.aws.amazon.com/ebs/latest/userguide/automate-app-consistent-backups.html)

Alibaba Cloud 同样说明，运行中数据库的数据可能仍在内存或写入途中；普通快照无法记录未落盘数据。Linux 应用一致快照依赖客户提供的 pre/post shell scripts，厂商不保证自定义脚本本身正确。[Alibaba Cloud 应用一致快照](https://www.alibabacloud.com/help/en/ecs/user-guide/create-application-consistent-snapshots-in-the-ecs-console/)

对嵌套架构的推论是：外层 Windows 云 VM 的磁盘/整机快照，即使对 Windows 文件系统一致，也不能自动证明 Ubuntu 内 PostgreSQL 已被正确协调；必须用 PostgreSQL 自身的备份恢复链作为数据库恢复依据。

Hyper-V checkpoint 也不等于长期备份。Microsoft 说明 Production Checkpoint 在 Windows 中使用 VSS、在 Linux 中使用文件系统冻结来创建数据一致的检查点，而 Standard Checkpoint 会保存 VM 内存状态；对数据库而言，Linux 文件系统冻结仍不能替代 PostgreSQL 自身的 WAL/PITR 和实际恢复验证。[Hyper-V checkpoints](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/checkpoints)

### 3.2 快照与 PITR 解决不同问题

| 能力 | 云盘 / VM 快照 | PostgreSQL 基础备份 + WAL/PITR |
| --- | --- | --- |
| 恢复对象 | 整盘、整机或一组云盘 | PostgreSQL 数据库集群 |
| 一致性 | 默认多为崩溃一致；应用一致需额外协调 | PostgreSQL 按自身 WAL 语义恢复一致状态 |
| 时间粒度 | 已创建的离散快照点 | 基础备份后、连续 WAL 覆盖范围内的目标时间点 |
| 适合场景 | OS/VM 整体损坏、升级前快速回滚、整机复制 | 误删、错误更新、数据库损坏、精确回到业务事故之前 |
| 局限 | 不能理解报价、审计和数据库事务；嵌套 VM 更复杂 | 不恢复 Windows/Ubuntu 配置、Docker 配置和对象文件 |

PostgreSQL 官方说明，连续 WAL 与基础备份组合后可以在基础备份之后的任意目标点停止恢复；同时 WAL 不会恢复 `postgresql.conf`、`pg_hba.conf` 等手工配置。[PostgreSQL 连续归档与 PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)

因此生产策略应叠加使用：云 VM/云盘快照作为整机灾备辅助，PostgreSQL PITR 作为数据库主恢复机制，`pg_dump` 作为可移植迁移/第二层备份，对象存储则独立启用版本、复制和恢复。不能用“云厂商每天有快照”替代应用级持久化方案。

## 4. 跨故障域、跨地域与跨账号备份

### 4.1 必须隔离共同故障

生产数据、数据库备份和对象备份如果都在同一台服务器、同一块盘或同一管理员凭证下，会共同遭遇主机损坏、账号误操作、勒索软件或区域故障。最低边界应是：

- 运行副本与备份副本分离；备份不能只在 PostgreSQL/MinIO 所在 VM 的本地磁盘。
- 至少一份备份位于不同故障域；正式生产优先使用不同地域或不同账号/租户的备份库。
- 目标账号使用独立最小权限、独立加密密钥和删除保护；生产应用凭证不能删除灾备副本。
- 数据库、对象、部署配置和恢复手册一起保护；只恢复数据库但丢失照片/合同，仍属恢复失败。

AWS Backup 官方支持把备份按计划复制到同一组织的其他账号，并明确将其用于操作或安全隔离；原备份误删时可以从目标账号复制回来恢复。[AWS 跨账号备份](https://docs.aws.amazon.com/aws-backup/latest/devguide/create-cross-account-backup.html)

Alibaba Cloud Cloud Backup 也提供跨账号备份/备份库复制，并明确指出账号级隔离可实现集中数据保护；但功能、区域和资源类型均需按产品核实。[Alibaba Cloud 跨账号备份](https://www.alibabacloud.com/help/en/cloud-backup/user-guide/back-up-data-sources-across-alibaba-cloud-accounts)

这些示例证明“跨账号/跨地域”是需要主动配置的产品能力，不是购买云服务器后自动获得。供应商未定时应把它写入采购验收条件，而不是在架构中假设存在。

### 4.2 高可用不能替代备份

同可用区/跨可用区副本主要降低硬件或节点故障的停机时间，也会迅速复制应用错误。托管数据库的 HA、PITR 和跨地域灾备要分别询价和验收。

恢复演练至少要分别验证：单个对象误删、报价或财务数据误更新、PostgreSQL 整库恢复、Ubuntu VM 丢失、主地域不可用、生产账号凭证失陷。仅验证“控制台中能看到备份任务成功”不足以证明可恢复。

## 5. 托管 PostgreSQL / 对象存储与自建方案

### 5.1 托管方案实际转移了哪些工作

主流托管 PostgreSQL 产品提供自动备份、PITR 和可选的多可用区高可用。例如 Amazon RDS 会在备份窗口创建自动备份，并可在保留期内恢复到时间点；Multi-AZ 可自动故障转移。[Amazon RDS 自动备份](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html) [Amazon RDS Multi-AZ](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)

Azure Database for PostgreSQL Flexible Server 提供 7–35 天的操作备份/PITR，可选可用区冗余 HA；更长期保留需使用额外 Azure Backup 能力。[Azure PostgreSQL 业务连续性](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-business-continuity) [Azure PostgreSQL 长期备份](https://learn.microsoft.com/en-us/azure/backup/backup-azure-database-postgresql-flex-overview)

Alibaba Cloud RDS for PostgreSQL 提供数据备份、日志备份/PITR，并列出跨地域、跨账号和高频备份能力；具体版本、地域、实例版本和存储类型会影响可用功能。[Alibaba Cloud RDS PostgreSQL 备份](https://www.alibabacloud.com/help/en/rds/apsaradb-rds-for-postgresql/backup-2/)

托管对象存储则把多设备/多可用区冗余、容量扩展和底层校验交给厂商。例如 Alibaba Cloud OSS 的 ZRS 会把冗余数据放在同地域多个可用区，并提供跨地域复制能力。[Alibaba Cloud OSS ZRS](https://www.alibabacloud.com/help/en/oss/user-guide/zrs) [Alibaba Cloud OSS 概览](https://www.alibabacloud.com/help/en/aibaba-cloud-storage-services/latest/object-storage-service)

这些能力显著减少日常运维，但客户仍必须启用正确的保留期、版本、跨域复制、告警和恢复测试。

### 5.2 托管方案的限制

- 托管 PostgreSQL 通常不提供操作系统访问或真正 PostgreSQL superuser；RDS 提供受限的 `rds_superuser`，Azure 将真正 superuser 限制给平台控制面。可安装扩展、参数、日志和备份下载方式均受产品支持清单约束。[RDS PostgreSQL 权限](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html) [Azure PostgreSQL 权限](https://learn.microsoft.com/en-us/azure/postgresql/security/security-access-control)
- 托管产品可能晚于 PostgreSQL 社区发布新主版本或扩展版本，并可能限制原生备份文件导出、跨账号复制或最长 PITR 保留期。
- HA、跨地域副本、长期备份、出站流量和恢复产生额外费用；供应商未定时不能先写死这些功能均包含在基础价格内。
- 云厂商负责运行平台，不负责山屿的报价版本语义、审计完整性、对象引用和恢复后的业务验收。

### 5.3 自建 PostgreSQL + MinIO 的责任

自建方案保留 PostgreSQL/MinIO 的全部控制权，能保持本地与生产环境相似，也更容易使用标准 `pg_dump`、`pg_basebackup` 和 S3 API 迁移。但团队必须自行承担：

- PostgreSQL、MinIO、Ubuntu、Docker 和 Hyper-V/Windows 的补丁与安全更新；
- WAL 归档、基础备份、对象复制、容量和备份链监控；
- 数据库崩溃、磁盘耗尽、证书/密钥、跨地域复制和恢复演练；
- 单 VM 的数据库和 MinIO 不具备节点级高可用，云盘冗余也不等价于应用级副本。

因此“自建”不是没有云服务费用之外的零成本选项，而是把平台运维工作转回项目团队。

## 6. 面向山屿 ERP 的方案排序

### 方案 A：直接 Linux VM + 托管 PostgreSQL + 托管对象存储（生产首选）

适用条件：最终云厂商提供受支持的 PostgreSQL 主版本、必要扩展、私网连接、PITR、备份导出和对象版本/跨域保护，费用可接受。

优点：删除 Windows 和嵌套 Hyper-V 层；数据库、对象的底层冗余、补丁和基础备份由平台承担；对约 20 人的初期系统减少最多运维责任。应用继续使用标准 PostgreSQL 协议和 S3 适配器，保留未来迁移能力。

仍由项目负责：schema migration、逻辑备份/导出、报价与审计完整性、对象 checksum、跨账号/地域策略及恢复验收。

### 方案 B：直接 Linux VM + 自建 PostgreSQL + MinIO

适用条件：托管数据服务不可用、版本/功能不满足或成本不可接受，并且明确有人承担数据库与对象存储运维。

优点：部署简单于 Windows 嵌套方案，控制权和本地一致性较高。

硬性补偿：连续 WAL/PITR、异机对象复制、独立云备份库、监控告警和季度恢复演练必须在上线前完成，不能只使用同机 Docker volume 和云盘快照。

### 方案 C：Windows Server + Hyper-V + Ubuntu VM + 数据服务

只在 Windows Server 有其他强制工作负载时采用。采购必须证明嵌套虚拟化受支持；生产数据层仍优先放在托管 PostgreSQL/对象存储。若 PostgreSQL 与 MinIO 也放进嵌套 Ubuntu，同一云实例会成为 Windows、Hyper-V、Ubuntu、容器、数据库和对象存储的共同故障点，必须配置服务器外备份并接受更高 RTO。

### 不应采用的组合

“普通 Windows 云 VM + 未确认支持的 Hyper-V + Ubuntu 内自建 PostgreSQL/MinIO + 仅依赖云盘快照”不满足长期持久化要求。它同时存在部署兼容风险、单机共同故障和缺乏数据库 PITR 三个问题。

## 7. 供应商采购与上线门槛

供应商未定时，以下项目必须成为询价和 PoC 验收清单：

1. 是否可以直接购买受支持的 Ubuntu LTS VM；若必须 Windows，具体 SKU 是否支持生产级 Hyper-V 嵌套虚拟化及其限制。
2. 可用区、磁盘冗余和 VM/磁盘快照分别提供什么一致性；Linux 内 PostgreSQL 如何实现应用一致快照。
3. 托管 PostgreSQL 是否提供项目选定主版本、必要扩展、私网访问、HA、PITR、可配置保留期、跨地域/跨账号备份、备份下载和标准 `pg_dump`/`pg_restore`。
4. 托管对象存储是否支持版本控制、checksum、生命周期、不可变保留、跨地域复制和跨账号隔离；接口是否为 S3 或需单独适配。
5. 备份是否与生产资源处于不同故障域；生产管理员或应用凭证是否能够同时删除所有备份。
6. 费用是否覆盖快照容量、PITR/WAL、跨地域复制、长期归档、对象请求、恢复和流量，而不只比较 VM 月租。
7. 能否在 PoC 中实际完成一次数据库指定时间恢复、一个误删对象恢复、一个全新 VM 重建和一次跨账号/地域副本读取。

完成以上验证前，不应把当前 Windows Server + Hyper-V 架构从“条件方案”视为最终生产结论，也不应采购长期云资源。

## 官方资料索引

- Microsoft：[共享责任](https://learn.microsoft.com/en-us/azure/security/fundamentals/shared-responsibility)、[Hyper-V 安装条件](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/Install-Hyper-V)、[嵌套虚拟化](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/enable-nested-virtualization)、[Hyper-V checkpoints](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/checkpoints)、[Ubuntu on Hyper-V](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/supported-ubuntu-virtual-machines-on-hyper-v)、[Azure 磁盘备份](https://learn.microsoft.com/en-us/azure/virtual-machines/backup-and-disaster-recovery-for-azure-iaas-disks)、[Azure PostgreSQL 业务连续性](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/concepts-business-continuity)。
- PostgreSQL：[连续归档与 PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)、[pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)、[pg_verifybackup](https://www.postgresql.org/docs/current/app-pgverifybackup.html)。
- AWS：[EC2 嵌套虚拟化](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html)、[应用一致 EBS 快照](https://docs.aws.amazon.com/ebs/latest/userguide/automate-app-consistent-backups.html)、[跨账号备份](https://docs.aws.amazon.com/aws-backup/latest/devguide/create-cross-account-backup.html)、[RDS 自动备份](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)。
- Alibaba Cloud：[ECS 二次虚拟化限制](https://www.alibabacloud.com/help/en/ecs/user-guide/limitations)、[应用一致快照](https://www.alibabacloud.com/help/en/ecs/user-guide/create-application-consistent-snapshots-in-the-ecs-console/)、[RDS PostgreSQL 备份](https://www.alibabacloud.com/help/en/rds/apsaradb-rds-for-postgresql/backup-2/)、[跨账号备份](https://www.alibabacloud.com/help/en/cloud-backup/user-guide/back-up-data-sources-across-alibaba-cloud-accounts)、[OSS ZRS](https://www.alibabacloud.com/help/en/oss/user-guide/zrs)。
