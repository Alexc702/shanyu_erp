import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchProjects, fetchSession } from "@/lib/api-client";

export default async function ProjectsPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  const projects = await fetchProjects(cookieHeader);
  if (!projects) {
    redirect("/");
  }

  return (
    <AppShell active="projects" user={session.user}>
      <main className="page-content">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">项目管理</p>
            <h1>住宅项目</h1>
            <p>项目身份会持续贯穿报价及后续阶段，不因阶段切换重复创建。</p>
          </div>
          <Link className="primary-button inline-button" href="/projects/new">
            新建项目
          </Link>
        </section>

        {projects.length === 0 ? (
          <section className="panel empty-panel">
            <h2>还没有可访问的项目</h2>
            <p>创建第一个项目并配置空间。</p>
          </section>
        ) : (
          <section className="project-card-grid">
            {projects.map((project) => (
              <Link className="project-card" href={`/projects/${project.id}`} key={project.id}>
                <div className="project-card-topline">
                  <span>住宅项目</span>
                  <span>{project.buildingArea} ㎡</span>
                </div>
                <h2>{project.name}</h2>
                <p>{project.customerName}</p>
                <div className="project-card-footer">
                  <span>{project.address}</span>
                  <strong>{project.leadDesigner.displayName}</strong>
                </div>
              </Link>
            ))}
          </section>
        )}
      </main>
    </AppShell>
  );
}
