import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
            <h1>{project.name} · {project.customerName}</h1>
            <p>
              {Number(project.buildingArea).toFixed(2)}㎡ · 主案 {project.leadDesigner.displayName} · 当前 V1
            </p>
          </div>
          <div className="project-hero-actions">
            <Badge variant="secondary">草稿</Badge>
            <Button disabled title="阶段 6 开放" variant="outline">版本记录</Button>
            {session.user.role === "OWNER" ? (
              <Button asChild variant="outline">
                <Link href={`/projects/${project.id}/quotation/cost-margin`}>
                  查看预计成本毛利
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href={`/projects/${project.id}/quotation`}>继续编辑半包</Link>
            </Button>
          </div>
        </section>

        <section className="project-status-flow" aria-label="报价状态">
          {["草稿", "待定价/待补充", "待审批", "已批准"].map((label, index) => (
            <div className={index === 0 ? "status-step active" : "status-step"} key={label}>
              <span className="status-step-number">{index + 1}</span>
              <span>{label}</span>
            </div>
          ))}
        </section>

        <section className="project-overview-grid">
          <article className="panel">
            <div className="module-card">
              <div>
                <p className="eyebrow">V1 报价模块</p>
                <h2>半包工程</h2>
                <p>8 个报价分区 · 161 个标准工程项 · 使用已发布主材库版本</p>
              </div>
              <div>
                <Badge>编辑中</Badge>
                <Button asChild className="inline-button" size="sm" variant="outline">
                  <Link href={`/projects/${project.id}/quotation`}>继续编辑半包 →</Link>
                </Button>
              </div>
            </div>
          </article>
          <aside className="panel project-space-summary">
            <h2>项目与空间</h2>
            <dl>
              <div><dt>建筑面积</dt><dd>{Number(project.buildingArea).toFixed(2)}㎡</dd></div>
              <div><dt>主案设计师</dt><dd>{project.leadDesigner.displayName}</dd></div>
              <div><dt>空间数量</dt><dd>{project.spaces.length}</dd></div>
              <div><dt>报价模板</dt><dd>山屿标准半包</dd></div>
            </dl>
          </aside>
        </section>

        <section className="space-section-heading">
          <div><p className="eyebrow">空间配置</p><h2>项目空间</h2></div>
          <p>空间名称或参数影响自动项时，以服务端重算结果为准。</p>
        </section>
        <SpaceManager projectId={project.id} spaces={project.spaces} />
      </main>
    </AppShell>
  );
}
