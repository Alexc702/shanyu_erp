---
status: accepted
date: 2026-08-28
---

# 分离本地开发与 Windows Server 生产运行边界

本地编码和试运行使用 macOS：Next.js、NestJS 直接运行，Docker Compose 只承载
PostgreSQL 与 MinIO。长期生产环境使用一台 Windows Server 云服务器作为宿主机，
由 Hyper-V 承载一台 Ubuntu LTS Linux 虚拟机，并在虚拟机内通过 Docker Engine 与
Compose 运行反向代理、Web、API、PostgreSQL 和 MinIO。这样既保留本地开发效率，
又让生产环境使用统一、可重复部署的 Linux 容器；不在 Windows Server 上使用不受支持的
Docker Desktop，也不把 Node.js、PostgreSQL 和 MinIO 拆成需要分别维护的原生
Windows 服务。

## Consequences

- 本地 `compose.yaml` 只定义 PostgreSQL 与 MinIO；生产部署使用独立的
  `compose.prod.yaml`，在上线阶段创建。
- Windows Server 云实例必须支持 Hyper-V 或嵌套虚拟化；若云厂商不支持，应在上线前
  调整主机方案，不退回到 Docker Desktop 生产部署。
- 当前采用单机应用栈，不承担 Kubernetes 或多节点高可用成本；生产可靠性通过 HTTPS、
  健康检查、自动重启、日志轮转、异机备份和恢复演练保障。
