import { cookies } from "next/headers";
import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { fetchProjects, fetchSession } from "@/lib/api-client";
import { getWorkbench } from "@/lib/workbench";

export default async function Home() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  const workbench = getWorkbench(session.user.role);
  const canAccessProjects =
    session.user.role === "OWNER" || session.user.role === "LEAD_DESIGNER";
  const projects = canAccessProjects ? await fetchProjects(cookieHeader) : null;
  const isOwner = session.user.role === "OWNER";
  const metrics = isOwner
    ? [
        ["进行中项目", String(projects?.length ?? 0), "当前可访问项目"],
        ["待定价", "—", "阶段 6 接入"],
        ["待审批", "—", "阶段 6 接入"],
        ["半包预计毛利率", "—", "阶段 5 接入 · 仅老板可见"],
      ]
    : [
        ["我的项目", String(projects?.length ?? 0), "本人负责"],
        ["草稿", "—", "半包报价持续保存"],
        ["已退回", "—", "阶段 6 接入"],
        ["已批准", "—", "阶段 6 接入"],
      ];

  return (
    <AppShell active="dashboard" user={session.user}>
      <main className="page-content">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">工作台</p>
            <h1>上午好，{session.user.displayName}</h1>
            <p>
              {isOwner
                ? "查看全公司报价、待定价、审批与预计毛利"
                : session.user.role === "LEAD_DESIGNER"
                  ? "仅显示本人负责或获授权的项目；不返回成本与毛利"
                  : workbench.description}
            </p>
          </div>
          {canAccessProjects ? (
            <Button asChild>
              <Link href="/projects/new"><Plus />新建项目</Link>
            </Button>
          ) : null}
        </section>

        <section className="metric-grid" aria-label="业务概览">
          {metrics.map(([label, value, hint]) => (
            <article className="metric-card" key={label}>
              <p>{label}</p>
              <strong>{value}</strong>
              <small>{hint}</small>
            </article>
          ))}
        </section>

        <section className="dashboard-grid">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{isOwner ? "今日待办" : "最近编辑"}</p>
                <h2>{projects?.length ? "可继续处理的项目" : "暂无待处理项目"}</h2>
              </div>
              <span className="status-dot">系统正常</span>
            </div>
            {projects?.length ? (
              <div className="recent-project-list">
                {projects.slice(0, 3).map((project) => (
                  <Link href={`/projects/${project.id}`} key={project.id}>
                    <strong>{project.name} · {project.customerName}</strong>
                    <span>{Number(project.buildingArea).toFixed(2)} M² · 打开项目</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted-copy">创建项目后，最近编辑和阶段状态会显示在这里。</p>
            )}
          </article>

          <article className="panel action-panel">
            <p className="eyebrow">{isOwner ? "异常与提醒" : "当前权限"}</p>
            <h2>{workbench.roleLabel}</h2>
            <ul className="check-list">
              {isOwner ? (
                <>
                  <li>主材库已发布版本可供新报价引用</li>
                  <li>成本与毛利仅老板接口返回</li>
                  <li>已保存草稿使用固定模板快照</li>
                </>
              ) : (
                <>
                  <li>创建项目、空间和半包草稿</li>
                  <li>使用已发布标准销售价</li>
                  <li>不可查看成本、毛利或修改标准价</li>
                </>
              )}
            </ul>
          </article>
        </section>
      </main>
    </AppShell>
  );
}
