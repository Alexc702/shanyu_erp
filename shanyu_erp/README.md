# 山屿 ERP

山屿 ERP 用于承载装修项目从报价、施工交付到财务结算的长期业务链路。

## 当前状态

- 阶段：V1 阶段 1“账号、会话与固定角色”和阶段 2“项目与统一空间”已实现，阶段 3“主材库半包标准工程项导入”待开始。
- 当前交付切片：一期“半包报价 + 主材库”；主材库在 V1 只实现半包标准工程项，不实现主材 SKU。
- 代码：已包含 PostgreSQL 迁移、本地演示账号/项目、登录/退出/会话、服务端权限与审计、角色工作台、老板用户管理、项目列表/新建/概览和空间维护。
- 执行计划：[V1 半包报价可执行开发计划](./docs/product/v1-half-package-development-plan.md)。

## 需求与设计基线

开发冲突时按以下顺序判定：

1. 用户或装修公司老板最新确认的结论；
2. 当期详细需求及最新结构化数据；
3. `../山屿erp设计稿.pen`；
4. `../室内装修ERP在线平台_PRD.md`；
5. 早期概述、录音文字及旧设计评审记录。

一期详细需求是首个交付切片，不是系统总边界。项目结构不得假设“一期即全部产品”。

## 领域导航

见 [CONTEXT-MAP.md](./CONTEXT-MAP.md) 和 [交付阶段边界](./docs/product/phase-boundaries.md)。

## 工程结构

```text
apps/web/           Next.js App Router 前端
apps/api/           NestJS 模块化单体后端
packages/contracts/ 前后端传输契约（不包含数据库实体）
docs/               产品、领域和架构文档
compose.yaml        本地 PostgreSQL 与 MinIO
```

Next.js 和 NestJS 直接在 macOS 上运行；Docker 只承载 PostgreSQL 与
MinIO。NestJS 是唯一业务后端，Web 不直接访问数据库，也不复制计价、
审批或权限规则。

## 本地开发

需要 Node.js `24.20.0`、pnpm `10.29.2` 和 Docker Desktop。

```bash
corepack enable
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web：<http://localhost:3000>
- API 健康检查：<http://localhost:3001/health>
- MinIO API：<http://localhost:9000>
- MinIO Console：<http://localhost:9001>

也可分别运行 `pnpm dev:web` 和 `pnpm dev:api`。本地基础设施状态使用
`docker compose ps` 查看。

本地演示账号为 `owner`（老板）、`alex`（主案设计师）和 `mori`（木作设计师）。
密码读取 `.env` 的 `DEMO_USER_PASSWORD`；未设置时仅在本地开发使用默认值
`Shanyu123!`。种子命令可重复执行，并会恢复三个演示账号及
`静悦府（演示）`项目的基础信息与两个基准空间。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

提交前可以用 `pnpm check:env` 一次完成工具版本、Docker 基础设施、
质量门禁和 Web/API 探活。如果 `pnpm dev` 已在运行，使用
`pnpm check:env:runtime`。详细检查项、预期结果和服务器定时巡检见
[环境自检手册](./docs/operations/environment-self-check.md)。

本地密钥只存放在已忽略的 `.env` 中，不得提交该文件或真实密码。

## 生产运行边界

长期运行目标是一台 Windows Server 云服务器。Windows Server 作为基础设施宿主机，
通过 Hyper-V 运行一台 Ubuntu LTS Linux 虚拟机；反向代理、Web、API、PostgreSQL
和 MinIO 均在该虚拟机内通过 Docker Engine 与 Compose 运行。生产环境不使用
Docker Desktop，也不在 Windows 宿主机中分别安装 Node.js、PostgreSQL 和 MinIO。

当前 `compose.yaml` 只服务于本地开发。正式上线前将另行建立
`compose.prod.yaml`，并完成域名、HTTPS、密钥、异机备份、日志轮转和恢复演练配置。
详细决定见 [ADR-0001](./docs/adr/0001-local-development-and-windows-server-production.md)。
