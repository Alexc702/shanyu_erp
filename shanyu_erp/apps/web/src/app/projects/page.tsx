import { cookies } from "next/headers";
import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { fetchProjects, fetchSession } from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { ProjectList } from "./project-list";

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
  const hasOwnerAccess = hasOwnerPermissions(session.user.role);

  return (
    <AppShell active="projects" user={session.user}>
      <main className="page-content">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">项目管理</p>
            <h1>{hasOwnerAccess ? "全部项目" : "我的项目"}</h1>
            <p>
              {hasOwnerAccess
                ? "查看全公司项目及其当前报价状态。"
                : `查看并继续处理 ${session.user.displayName} 负责的项目。`}
            </p>
          </div>
          <Button asChild>
            <Link href="/projects/new"><Plus />新建项目</Link>
          </Button>
        </section>

        {projects.length === 0 ? (
          <section className="panel empty-panel">
            <h2>还没有可访问的项目</h2>
            <p>创建第一个项目并配置空间。</p>
          </section>
        ) : (
          <ProjectList projects={projects} />
        )}
      </main>
    </AppShell>
  );
}
