---
status: accepted
date: 2026-08-31
---

# 将部署包定义为可移植的 Linux Docker Compose 运行单元

山屿 ERP 的应用部署包直接面向 Ubuntu LTS + Docker Engine + Compose，
不把 Windows Server、Hyper-V 或某个云厂商写入应用脚本。当前 V1
先部署到腾讯云轻量 Ubuntu 实例进行远程验收；未来正式环境可以是
直接 Linux 云主机，也可以是 ADR-0001 中 Windows Server 内的 Ubuntu Guest。
两者使用同一份镜像、Compose、迁移、升级与回滚脚本。

## Consequences

- 应用镜像在 Mac 或 CI 中构建，低配服务器只加载或拉取已构建镜像。
- 公网只发布 Caddy 的 80/443；Web、API、PostgreSQL 和对象存储仅使用
  Compose 内部网络。
- 测试环境可显式使用 IP + HTTP，但必须设置
  `SESSION_COOKIE_SECURE=false`；正式环境必须使用域名 + HTTPS 和
  `SESSION_COOKIE_SECURE=true`。
- 2GB 测试机不启动尚未被 V1 业务代码使用的 MinIO；这是容量受限的
  验收拓扑，不改变 ADR-0002 对正式文件持久化和异机备份的要求。
- 数据库迁移只向前执行；应用回滚只切换前一组镜像，不自动执行
  destructive schema down migration。
