import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  fetchPendingApprovals,
  fetchProjects,
  fetchSession,
} from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { ApprovalList } from "./approval-list";

export default async function ApprovalsPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (!hasOwnerPermissions(session.user.role)) notFound();

  const [quotations, projects] = await Promise.all([
    fetchPendingApprovals(cookieHeader),
    fetchProjects(cookieHeader),
  ]);
  if (!quotations || !projects) notFound();

  const leadDesigners = new Map(
    projects.map((project) => [
      project.id,
      project.leadDesigner.displayName,
    ]),
  );

  return (
    <AppShell active="approvals" user={session.user}>
      <ApprovalList
        quotations={quotations.map((quotation) => ({
          ...quotation,
          leadDesignerName: leadDesigners.get(quotation.projectId) ?? "—",
        }))}
      />
    </AppShell>
  );
}
