import { cookies } from "next/headers";
import { Plus, ShieldCheck, UserRound } from "lucide-react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

const permissions = [
  ["项目报价", "查看全部", "负责项目", "不可查看", "暂未开放", "暂未开放"],
  ["主材库", "销售价与成本价", "仅销售价", "不可查看", "暂未开放", "暂未开放"],
  ["用户与权限", "创建与查看", "不可查看", "不可查看", "不可查看", "不可查看"],
] as const;

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
          <Dialog>
            <DialogTrigger asChild>
              <Button><Plus />新增用户</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新增公司成员</DialogTitle>
                <DialogDescription>账号角色由服务端统一判定，成员不能自行修改。</DialogDescription>
              </DialogHeader>
              <NewUserForm />
            </DialogContent>
          </Dialog>
        </section>

        <section className="user-card-grid">
          {users.slice(0, 3).map((user) => (
            <article className="user-card" key={user.id}>
              <span className="user-card-icon"><UserRound /></span>
              <div>
                <h2>{user.displayName}</h2>
                <p>{roleLabels[user.role]} · {user.account}</p>
                <Badge variant="secondary">正常</Badge>
              </div>
            </article>
          ))}
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

        <section className="panel permission-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow"><ShieldCheck /> 权限基线</p>
              <h2>角色权限矩阵</h2>
              <p>V1 仅开放报价与主材库；施工和财务不在本阶段实现。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>功能</th><th>老板</th><th>主案设计师</th><th>木作设计师</th><th>项目经理</th><th>财务</th></tr></thead>
              <tbody>
                {permissions.map(([feature, ...cells]) => (
                  <tr key={feature}>
                    <td><strong>{feature}</strong></td>
                    {cells.map((cell, index) => <td key={`${feature}-${index}`}>{cell}</td>)}
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
