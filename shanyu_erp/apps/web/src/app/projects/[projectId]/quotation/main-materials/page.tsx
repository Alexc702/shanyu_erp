import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  fetchHalfPackageQuotation,
  fetchMainMaterialQuotation,
  fetchMainMaterialQuotationCatalog,
  fetchProject,
  fetchSession,
} from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { MainMaterialsEditor } from "./main-materials-editor";

export default async function MainMaterialsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (!hasOwnerPermissions(session.user.role) && session.user.role !== "LEAD_DESIGNER") {
    notFound();
  }
  const { projectId } = await params;
  const [project, halfPackage] = await Promise.all([
    fetchProject(cookieHeader, projectId),
    fetchHalfPackageQuotation(cookieHeader, projectId),
  ]);
  if (!project || !halfPackage) notFound();
  const [catalog, quotation] = await Promise.all([
    fetchMainMaterialQuotationCatalog(cookieHeader, projectId),
    fetchMainMaterialQuotation(cookieHeader, projectId),
  ]);
  if (!catalog || !quotation) notFound();
  return (
    <AppShell active="quotation" user={session.user}>
      <MainMaterialsEditor
        canViewCosts={hasOwnerPermissions(session.user.role)}
        catalog={catalog}
        initialQuotation={quotation}
        projectAddress={project.projectAddress}
      />
    </AppShell>
  );
}
