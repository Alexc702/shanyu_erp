import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchSession, fetchUsers } from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { CreateProjectForm } from "./create-project-form";

export default async function NewProjectPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  const hasOwnerAccess = hasOwnerPermissions(session.user.role);
  if (!hasOwnerAccess && session.user.role !== "LEAD_DESIGNER") {
    redirect("/");
  }
  const users = hasOwnerAccess ? await fetchUsers(cookieHeader) : [];
  const leadDesigners = (users ?? []).filter((user) => user.role === "LEAD_DESIGNER");

  return (
    <AppShell active="projects" user={session.user}>
      <main className="page-content">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">项目管理</p>
            <h1>新建项目</h1>
            <p>建立稳定项目与空间后，直接进入半包报价。</p>
          </div>
          <Link className="text-link" href="/projects">返回项目列表</Link>
        </section>
        <div className="project-status-flow" aria-label="创建步骤">
          {[["1", "项目信息"], ["2", "空间配置"], ["3", "确认创建"]].map(
            ([number, label], index) => (
              <div className={index < 2 ? "status-step active" : "status-step"} key={number}>
                <span className="status-step-number">{number}</span>
                <span>{label}</span>
              </div>
            ),
          )}
        </div>
        <CreateProjectForm currentUser={session.user} leadDesigners={leadDesigners} />
      </main>
    </AppShell>
  );
}
