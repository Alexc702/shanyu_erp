import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  fetchHalfPackageQuotation,
  fetchSession,
} from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { QuotationEditor } from "./quotation-editor";

interface QuotationPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function QuotationPage({ params }: QuotationPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  const hasOwnerAccess = hasOwnerPermissions(session.user.role);
  if (!hasOwnerAccess && session.user.role !== "LEAD_DESIGNER") {
    notFound();
  }
  const { projectId } = await params;
  const quotation = await fetchHalfPackageQuotation(cookieHeader, projectId);
  if (!quotation) {
    notFound();
  }

  return (
    <AppShell active="quotation" user={session.user}>
      <QuotationEditor
        canViewCosts={hasOwnerAccess}
        initialQuotation={quotation}
      />
    </AppShell>
  );
}
