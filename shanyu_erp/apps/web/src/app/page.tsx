import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchProjects, fetchSession } from "@/lib/api-client";
import { getWorkbench } from "@/lib/workbench";

export default async function Home() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  const workbench = getWorkbench(session.user.role);
  const projects =
    session.user.role === "OWNER" || session.user.role === "LEAD_DESIGNER"
      ? await fetchProjects(cookieHeader)
      : null;

  return (
    <AppShell active="dashboard" user={session.user}>
      <main className="page-content">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">工作台</p>
            <h1>你好，{session.user.displayName}</h1>
            <p>{workbench.description}</p>
          </div>
          <span className="role-pill">{workbench.roleLabel}</span>
        </section>

        <section className="metric-grid" aria-label="业务概览">
          {[
            ["进行中项目", projects ? String(projects.length) : "—", projects ? "当前可访问项目" : "当前角色无项目权限"],
            ["待处理报价", "—", "半包报价阶段接入后显示"],
            ["待审批事项", "—", "审批阶段接入后显示"],
          ].map(([label, value, hint]) => (
            <article className="metric-card" key={label}>
              <p>{label}</p>
              <strong>{value}</strong>
              <small>{hint}</small>
            </article>
          ))}
        </section>

        <section className="dashboard-grid">
          <article className="panel stage-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">当前交付</p>
                <h2>项目与空间框架</h2>
              </div>
              <span className="status-dot">运行中</span>
            </div>
            <ul className="check-list">
              <li>本地账号登录与安全会话</li>
              <li>老板、主案、木作固定角色</li>
              <li>服务端权限判定与审计留痕</li>
              <li>稳定项目 ID 与统一空间参数</li>
            </ul>
          </article>

          <article className="panel action-panel">
            <p className="eyebrow">快捷入口</p>
            <h2>{workbench.canManageUsers ? "管理公司账号" : "当前没有待办"}</h2>
            <p>
              {workbench.canManageUsers
                ? "创建成员账号并分配固定角色。"
                : "业务模块会按已确认的开发阶段逐步开放。"}
            </p>
            {workbench.canManageUsers ? (
              <Link className="primary-button inline-button" href="/users">
                进入用户与权限
              </Link>
            ) : null}
          </article>
        </section>
        {projects && projects.length > 0 ? (
          <section className="panel recent-projects-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">最近项目</p>
                <h2>项目与空间</h2>
              </div>
              <Link className="text-link" href="/projects">查看全部</Link>
            </div>
            <div className="recent-project-list">
              {projects.slice(0, 3).map((project) => (
                <Link href={`/projects/${project.id}`} key={project.id}>
                  <strong>{project.name}</strong>
                  <span>{project.customerName} · {project.buildingArea} ㎡</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
