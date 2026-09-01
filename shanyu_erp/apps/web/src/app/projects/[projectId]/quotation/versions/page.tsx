import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  fetchAuditEvents,
  fetchProject,
  fetchQuotationVersion,
  fetchQuotationVersions,
  fetchSession,
} from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { VersionHistory } from "./version-history";

interface VersionPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function ProjectVersionsPage({
  params,
}: VersionPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (
    !hasOwnerPermissions(session.user.role) &&
    session.user.role !== "LEAD_DESIGNER"
  ) {
    notFound();
  }

  const { projectId } = await params;
  const [project, versions, auditEvents] = await Promise.all([
    fetchProject(cookieHeader, projectId),
    fetchQuotationVersions(cookieHeader, projectId),
    session.user.role === "ADMIN"
      ? fetchAuditEvents(cookieHeader)
      : Promise.resolve(null),
  ]);
  if (!project || !versions?.length) notFound();

  const currentQuotation = await fetchQuotationVersion(
    cookieHeader,
    versions[0].id,
  );

  return (
    <AppShell active="projects" user={session.user}>
      <VersionHistory
        auditEvents={auditEvents ?? []}
        currentTemplateVersion={currentQuotation?.templateVersion ?? null}
        project={project}
        user={session.user}
        versions={versions}
      />
    </AppShell>
  );
}
