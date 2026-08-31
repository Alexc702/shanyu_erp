import { cookies } from "next/headers";
import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
            <h1>{session.user.role === "OWNER" ? "全部项目" : "我的项目"}</h1>
            <p>
              {session.user.role === "OWNER"
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
          <section className="panel project-table-panel">
            <div className="project-table-toolbar" aria-label="项目筛选">
              <input className="filter-control filter-search" placeholder="搜索项目 / 客户 / 地址" />
              <button className="filter-control" type="button">全部状态</button>
              <button className="filter-control" type="button">全部版本</button>
              <button className="filter-control" type="button">最近更新</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>项目 / 客户</th>
                    <th>地址</th>
                    <th>建筑面积</th>
                    <th>主案设计师</th>
                    <th>报价状态</th>
                    <th>半包金额</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td>
                        <strong>{project.name}</strong>
                        <span className="table-secondary">{project.customerName}</span>
                      </td>
                      <td>{project.address}</td>
                      <td>{Number(project.buildingArea).toFixed(2)} ㎡</td>
                      <td>{project.leadDesigner.displayName}</td>
                      <td><Badge variant="secondary">项目已创建</Badge></td>
                      <td>—</td>
                      <td><Link className="text-link" href={`/projects/${project.id}`}>打开项目</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}
