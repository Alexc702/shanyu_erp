# 山屿 ERP 开发规则

## 项目目标

山屿 ERP 是长期运行的云端装修 ERP。

当前交付范围是一期“半包报价 + 主材库”，但项目、报价、施工交付、
财务和授权应保持清晰的长期领域边界。

优先保证业务正确、数据可追溯、低成本维护，不为当前约 20 人规模
引入微服务、Kubernetes、事件总线等额外复杂度。

## 开始工作前

1. 使用 `README.md` 中定义的需求优先级处理需求冲突。
2. 修改业务模型前，阅读 `CONTEXT-MAP.md` 和对应
   `docs/contexts/*/CONTEXT.md`。
3. 修改版本范围前，阅读 `docs/product/phase-boundaries.md`。
4. 修改技术边界、部署方式或跨模块依赖前，阅读
   `docs/architecture/architecture-proposal.md` 和相关 ADR。
5. 涉及多个领域、数据库结构或公共 API 的任务，先列出实现计划、
   验收条件和受影响模块。

## 架构边界

- 保持 TypeScript 单仓库和模块化单体。
- `apps/web` 负责界面和交互，不重复实现报价、权限等核心业务规则。
- `apps/api` 按领域组织模块；模块通过公开接口协作，不访问其他模块内部实现。
- `packages/contracts` 只保存稳定的请求、响应和事件契约；数据库实体归 API
  所有，不得通过该包共享。
- 所有客户端通过 NestJS API 使用同一套业务规则。
- 一期只实现确认范围，不提前生成施工、财务等后续模块的空壳代码。
- 新增外部集成时使用适配器接缝；当前不拆分微服务。
- 本地开发时 PostgreSQL 与 MinIO 在 Docker 中运行；Next.js 与 NestJS 在 macOS
  进程中运行，以保留快速热更新。
- 生产环境以一台 Windows Server 云服务器为宿主机，在其 Hyper-V Linux 虚拟机内
  使用 Docker Engine 与 Compose 运行完整应用栈；不使用 Docker Desktop 作为
  Windows Server 生产运行时。具体边界遵循 ADR-0001。
- 保持当前模块化单体边界；只有明确需求和决策记录才能引入 Redis、消息队列
  或微服务。

## 目录结构

- `apps/web`：Next.js App Router、TypeScript、Tailwind CSS 和 ESLint。
- `apps/api`：启用 TypeScript strict 的 NestJS 唯一业务后端。
- `packages/contracts`：可被前后端依赖的传输契约。
- `docs`：产品、上下文和架构依据；`CONTEXT-MAP.md` 是领域导航。
- `compose.yaml`：仅定义本地 PostgreSQL 与 MinIO。
- `compose.prod.yaml`：正式部署阶段创建，用于 Linux 虚拟机内的完整生产应用栈；
  不得将本地密钥或本地端口暴露策略直接复制到生产环境。

## 运行与验证

使用 `.node-version`/`.nvmrc` 指定的 Node.js `24.20.0`，并通过
`packageManager` 指定的 pnpm `10.29.2` 执行命令。

1. `pnpm install` 安装整个 workspace。
2. `pnpm infra:up` 启动 PostgreSQL 和 MinIO；用 `docker compose ps`
   确认两者为 healthy。
3. `pnpm dev` 同时启动 Web 和 API；也可使用 `pnpm dev:web`、
   `pnpm dev:api` 分别启动。
4. 用 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 完成验证。
5. Web 必须可通过 `http://localhost:3000` 访问，API 健康检查必须可通过
   `http://localhost:3001/health` 访问。

## 业务不变量

- 同一装修事项在报价、施工和财务阶段共享稳定的项目 ID。
- 已发布或已批准报价必须保存版本快照；基础库调价不得修改历史报价。
- 报价计算、完整性校验、版本状态和权限判断以服务端结果为准。
- 金额计算不得使用 JavaScript 浮点数直接运算。
- 成本、底价和毛利必须进行独立的服务端权限校验。
- 关键审批、版本锁定和金额变更必须保留审计信息。
- 数据库结构变更通过迁移完成，不依赖手工修改生产数据库。

## 实现原则

- 优先完成可验收的垂直功能切片：数据、领域规则、API、界面和测试。
- 核心业务规则先写测试，再实现代码。
- 复用领域服务，避免在页面、导出和审批流程中复制计算逻辑。
- 保持接口和模块简单；只有出现真实需求时才增加抽象层。
- 不顺带重构与当前任务无关的代码。
- 发现需求歧义时记录问题，取得确认后再固化业务规则。

## 完成标准

任务只有同时满足以下条件才算完成：

- 实现结果符合当期 PRD、设计稿和明确的验收条件。
- 报价计算、版本快照、状态流转和权限变化具有相应测试。
- 数据库迁移可在全新 PostgreSQL 数据库中成功执行。
- 根目录的 lint、类型检查、测试和构建命令全部通过。
- Web、API 可在 macOS 上启动，PostgreSQL 与 MinIO 容器保持 healthy。
- 传输契约只位于 `packages/contracts`，数据库实体与业务规则只位于 API。
- `.env` 和任何真实密码均未进入 Git。
- 修改领域规则时同步更新对应 `CONTEXT.md`。
- 修改长期架构决策时新增或更新 ADR。
- 最终说明修改内容、验证结果和尚存风险。
