import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { fetchProject, fetchSession } from "@/lib/api-client";
import { ProjectAccess } from "./project-access";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const cookie = (await cookies()).toString();
  const session = await fetchSession(cookie);
  if (!session) redirect("/login");
  const project = await fetchProject(cookie, (await params).projectId);
  if (!project) notFound();
  const readOnly = session.user.role === "LEAD_DESIGNER" && project.leadDesigner.id !== session.user.id;
  return <ProjectAccess project={project} readOnly={readOnly}>{children}</ProjectAccess>;
}
