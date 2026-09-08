import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchHalfPackageQuotation, fetchMainMaterialQuotation, fetchSession, fetchSubmissionCheck } from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { SubmitQuotationPanel } from "./submit-quotation-panel";

interface SubmitPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function SubmitQuotationPage({ params }: SubmitPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (!hasOwnerPermissions(session.user.role) && session.user.role !== "LEAD_DESIGNER") notFound();
  const { projectId } = await params;
  const check = await fetchSubmissionCheck(cookieHeader, projectId);
  const [quotation, mainMaterial] = await Promise.all([
    fetchHalfPackageQuotation(cookieHeader, projectId),
    fetchMainMaterialQuotation(cookieHeader, projectId),
  ]);
  if (!quotation || !mainMaterial || !check || quotation.status !== "DRAFT") notFound();

  return (
    <AppShell active="quotation" user={session.user}>
      <SubmitQuotationPanel check={check} mainMaterial={mainMaterial} quotation={quotation} />
    </AppShell>
  );
}
