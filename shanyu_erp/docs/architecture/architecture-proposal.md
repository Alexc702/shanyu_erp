# 整体技术架构提案

> 状态：已接受。运行与部署边界见
> [ADR-0001](../adr/0001-local-development-and-windows-server-production.md)。

## 推荐结构

使用 **TypeScript 单仓库 + 模块化单体**：

- Web：Next.js App Router + shadcn/ui，实现桌面端报价、移动端审批和后续现场页面。
- 业务后端：NestJS，按项目、基础库、报价、施工交付、财务、组织与授权划分深模块。
- 数据库：PostgreSQL，报价版本、快照、审批和审计使用事务性持久化。
- 文件：开发和生产环境统一通过 S3 兼容接口访问 MinIO，不让业务代码依赖宿主机文件路径。
- 运行：本地开发时仅用 Docker Compose 启动 PostgreSQL 与 MinIO，Web/API
  直接运行在 macOS；生产环境在 Windows Server 承载的 Linux 虚拟机内用
  Docker Engine 与 Compose 运行完整应用栈。

## 运行与部署边界

### 本地开发和试运行

- Next.js 与 NestJS 直接作为 macOS 进程运行，保留快速热更新和调试能力。
- `compose.yaml` 只启动 PostgreSQL 与 MinIO；数据保存到 Docker 命名卷。
- 本地端口只绑定到 `127.0.0.1`，不作为公网共享环境使用。

### 云端长期运行

- 一台 Windows Server 云服务器作为基础设施宿主机；使用 Hyper-V 承载一台
  Ubuntu LTS Linux 虚拟机。云服务器规格必须支持 Hyper-V 或嵌套虚拟化，正式采购或
  部署前需要验证。
- Linux 虚拟机内安装 Docker Engine 和 Compose，容器化运行反向代理、Web、API、
  PostgreSQL 与 MinIO。Windows 宿主机不直接安装这些应用服务，也不使用
  Docker Desktop 作为生产运行时。
- 生产环境使用独立的 `compose.prod.yaml` 和环境变量；该文件在正式部署阶段按域名、
  证书、备份位置和密钥管理方案创建，不复用本地开发配置。
- 公网只开放 HTTP/HTTPS，并将 HTTP 重定向到 HTTPS；API、PostgreSQL、MinIO API
  和 MinIO 控制台默认只在内部网络访问。
- PostgreSQL 与 MinIO 使用持久化卷，并将自动备份保存到服务器之外；容器配置重启
  策略、健康检查和日志轮转。上线前必须完成一次恢复演练。
- 当前约 20 人规模只部署单机应用栈，不引入 Kubernetes、多节点高可用或微服务；
  可靠性优先依靠可重复部署、健康检查、异机备份和恢复演练。

## 为什么适合当前阶段

- Web 与 API 分离，后续企业微信、微信小程序或其他客户端可复用同一业务接口。
- 单体内部保持清晰模块接缝，不为尚未出现的规模承担微服务部署和数据一致性成本。
- 一期只实现项目、基础库、报价和授权模块；二期、三期保留语义边界，不先生成空壳代码。
- 统一计价、完整性校验、版本快照和权限判定各自位于单一深模块，页面、导出和审批不重复实现规则。

## 预留的真实接缝

- 文件存储：开发与生产环境均使用 MinIO 提供的 S3 兼容接口，未来可替换为云对象存储。
- 通知：站内通知 / 企业微信适配器。
- 身份登录：本地账号 / 后续企业微信身份。
- 导出：同一报价快照上的 PDF / Excel 适配器。
- 初始化数据：可重复执行的 Excel/CSV 导入器，不将原单元格地址引入生产规则。

## 不在当前提案中预先复杂化的内容

- 微服务、Kubernetes 或多云部署；
- 在一期代码中实现尚未确认的施工和财务页面；
- 用事件串联所有内部计算；对外集成真正出现时再增加事务外发箱。

## 参考

- [ADR-0001：本地开发与 Windows Server 生产运行边界](../adr/0001-local-development-and-windows-server-production.md)
- [Next.js 文档](https://nextjs.org/docs)
- [NestJS 文档](https://docs.nestjs.com/)
- [shadcn/ui 文档](https://ui.shadcn.com/docs)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [Docker Desktop 不支持 Windows Server](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/windowsfaqs/)
- [Windows Server Hyper-V 文档](https://learn.microsoft.com/windows-server/virtualization/hyper-v/)
