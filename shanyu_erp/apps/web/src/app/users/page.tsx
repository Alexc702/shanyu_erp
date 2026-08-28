import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchSession, fetchUsers } from "@/lib/api-client";
import { getWorkbench } from "@/lib/workbench";

import { NewUserForm } from "./new-user-form";

const roleLabels = {
  FINANCE: "财务（预留）",
  LEAD_DESIGNER: "主案设计师",
  OWNER: "老板",
  PROJECT_MANAGER: "项目经理（预留）",
  WOODWORK_DESIGNER: "木作设计师",
} as const;

export default async function UsersPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  if (!getWorkbench(session.user.role).canManageUsers) {
    redirect("/");
  }
  const users = await fetchUsers(cookieHeader);
  if (!users) {
    redirect("/");
  }

  return (
    <AppShell active="users" user={session.user}>
      <main className="page-content">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">系统管理</p>
            <h1>用户与权限</h1>
            <p>账号角色由服务端统一判定，成员不能自行修改。</p>
          </div>
        </section>

        <section className="panel create-user-panel">
          <div className="panel-heading">
            <div>
              <h2>新增公司成员</h2>
              <p>项目经理与财务仅建立角色，不开放施工或财务页面。</p>
            </div>
          </div>
          <NewUserForm />
        </section>

        <section className="panel users-panel">
          <div className="panel-heading">
            <div>
              <h2>账号列表</h2>
              <p>共 {users.length} 个内部账号</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>登录账号</th>
                  <th>手机号</th>
                  <th>角色</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td><strong>{user.displayName}</strong></td>
                    <td>{user.account}</td>
                    <td>{user.phone ?? "—"}</td>
                    <td><span className="table-role">{roleLabels[user.role]}</span></td>
                    <td><span className="active-state">启用</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
