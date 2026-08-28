import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchProject, fetchSession } from "@/lib/api-client";

import { SpaceManager } from "./space-manager";

interface ProjectPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  if (session.user.role !== "OWNER" && session.user.role !== "LEAD_DESIGNER") {
    redirect("/");
  }
  const { projectId } = await params;
  const project = await fetchProject(cookieHeader, projectId);
  if (!project) {
    notFound();
  }

  return (
    <AppShell active="projects" user={session.user}>
      <main className="page-content">
        <section className="project-hero">
          <div>
            <Link className="text-link" href="/projects">← 返回项目列表</Link>
            <p className="eyebrow">住宅项目</p>
            <h1>{project.name}</h1>
            <p>{project.customerName} · {project.address}</p>
          </div>
          <span className="role-pill">报价阶段</span>
        </section>

        <section className="project-facts">
          <div><span>建筑面积</span><strong>{project.buildingArea} ㎡</strong></div>
          <div><span>主案设计师</span><strong>{project.leadDesigner.displayName}</strong></div>
          <div><span>空间数量</span><strong>{project.spaces.length}</strong></div>
        </section>

        <section className="space-section-heading">
          <div><p className="eyebrow">空间配置</p><h2>项目空间</h2></div>
          <p>面积、周长、层高只作为 PRD 已确认的基础参数。</p>
        </section>
        <SpaceManager projectId={project.id} spaces={project.spaces} />
      </main>
    </AppShell>
  );
}
