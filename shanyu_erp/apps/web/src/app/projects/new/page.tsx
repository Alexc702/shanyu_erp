import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchSession, fetchUsers } from "@/lib/api-client";

import { CreateProjectForm } from "./create-project-form";

export default async function NewProjectPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  if (session.user.role !== "OWNER" && session.user.role !== "LEAD_DESIGNER") {
    redirect("/");
  }
  const users = session.user.role === "OWNER" ? await fetchUsers(cookieHeader) : [];
  const leadDesigners = (users ?? []).filter((user) => user.role === "LEAD_DESIGNER");

  return (
    <AppShell active="projects" user={session.user}>
      <main className="page-content">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">项目管理</p>
            <h1>新建住宅项目</h1>
            <p>先建立稳定项目与空间，半包报价将在下一阶段引用这些 ID。</p>
          </div>
          <Link className="text-link" href="/projects">返回项目列表</Link>
        </section>
        <CreateProjectForm currentUser={session.user} leadDesigners={leadDesigners} />
      </main>
    </AppShell>
  );
}
