import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchSession, fetchUserAuditEvents, fetchUsers } from "@/lib/api-client";
import { getWorkbench } from "@/lib/workbench";

import { UserManagement } from "./user-management";

export default async function UsersPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (!getWorkbench(session.user.role).canManageUsers) redirect("/");

  const [users, auditEvents] = await Promise.all([
    fetchUsers(cookieHeader),
    fetchUserAuditEvents(cookieHeader),
  ]);
  if (!users || !auditEvents) redirect("/");

  return (
    <AppShell active="users" user={session.user}>
      <UserManagement
        auditEvents={auditEvents}
        currentUser={session.user}
        generatedAt={new Date().toISOString()}
        users={users}
      />
    </AppShell>
  );
}
