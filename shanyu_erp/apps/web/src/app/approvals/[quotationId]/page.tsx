import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  fetchProject,
  fetchMainMaterialQuotationVersion,
  fetchQuotationVersion,
  fetchQuotationVersionCostMargin,
  fetchSession,
} from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { ApprovalDetail } from "./approval-detail";

interface ApprovalDetailPageProps {
  readonly params: Promise<{ quotationId: string }>;
}

export default async function ApprovalDetailPage({ params }: ApprovalDetailPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (!hasOwnerPermissions(session.user.role)) notFound();
  const { quotationId } = await params;
  const [quotation, costMargin] = await Promise.all([
    fetchQuotationVersion(cookieHeader, quotationId),
    fetchQuotationVersionCostMargin(cookieHeader, quotationId),
  ]);
  if (!quotation || !costMargin) notFound();
  const [project, mainMaterial] = await Promise.all([
    fetchProject(cookieHeader, quotation.projectId),
    fetchMainMaterialQuotationVersion(cookieHeader, quotation.projectId, quotation.id),
  ]);
  if (!project || !mainMaterial) notFound();
  return (
    <AppShell active="approvals" user={session.user}>
      <ApprovalDetail
        costMargin={costMargin}
        initialQuotation={quotation}
        mainMaterial={mainMaterial}
        project={project}
      />
    </AppShell>
  );
}
