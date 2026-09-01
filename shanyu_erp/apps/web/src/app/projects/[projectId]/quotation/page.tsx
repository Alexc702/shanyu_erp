import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  fetchHalfPackageQuotation,
  fetchProject,
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
  const [quotation, project] = await Promise.all([
    fetchHalfPackageQuotation(cookieHeader, projectId),
    fetchProject(cookieHeader, projectId),
  ]);
  if (!quotation || !project) {
    notFound();
  }

  return (
    <AppShell active="quotation" user={session.user}>
      <QuotationEditor
        buildingArea={project.buildingArea}
        canViewCosts={hasOwnerAccess}
        initialQuotation={quotation}
        leadDesignerName={project.leadDesigner.displayName}
      />
    </AppShell>
  );
}
