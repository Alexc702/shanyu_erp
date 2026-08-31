import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchQuotationVersion, fetchQuotationVersionCostMargin, fetchSession } from "@/lib/api-client";

import { ApprovalDetail } from "./approval-detail";

interface ApprovalDetailPageProps {
  readonly params: Promise<{ quotationId: string }>;
}

export default async function ApprovalDetailPage({ params }: ApprovalDetailPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (session.user.role !== "OWNER") notFound();
  const { quotationId } = await params;
  const [quotation, costMargin] = await Promise.all([
    fetchQuotationVersion(cookieHeader, quotationId),
    fetchQuotationVersionCostMargin(cookieHeader, quotationId),
  ]);
  if (!quotation || !costMargin) notFound();
  return <AppShell active="approvals" user={session.user}><ApprovalDetail costMargin={costMargin} initialQuotation={quotation} /></AppShell>;
}
