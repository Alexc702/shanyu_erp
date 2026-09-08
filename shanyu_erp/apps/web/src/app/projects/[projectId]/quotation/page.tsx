import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  fetchHalfPackageQuotation,
  fetchProject,
  fetchQuotationVersions,
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
  const [quotation, project, versions] = await Promise.all([
    fetchHalfPackageQuotation(cookieHeader, projectId),
    fetchProject(cookieHeader, projectId),
    fetchQuotationVersions(cookieHeader, projectId),
  ]);
  if (!quotation || !project) {
    notFound();
  }

  return (
    <AppShell active="quotation" user={session.user}>
      <QuotationEditor
        outerFrameArea={project.outerFrameArea}
        canViewCosts={hasOwnerAccess}
        initialQuotation={quotation}
        leadDesignerName={project.leadDesigner.displayName}
        returnReason={
          versions?.find(
            (version) =>
              version.id === quotation.id ||
              (version.status === "RETURNED" &&
                version.versionNumber === quotation.versionNumber - 1),
          )?.decisionReason ?? null
        }
      />
    </AppShell>
  );
}
