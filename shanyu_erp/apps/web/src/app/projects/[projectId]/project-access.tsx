"use client";

import { createContext, useContext, useEffect } from "react";
import type { ProjectDetail } from "@shanyu/contracts";
import { apiUrl } from "@/lib/api-url";

const ProjectReadonly = createContext(false);
export function useProjectReadonly() { return useContext(ProjectReadonly); }

export function ProjectAccess({ project, readOnly, children }: {
  project: ProjectDetail; readOnly: boolean; children: React.ReactNode;
}) {
  useEffect(() => {
    let active = true;
    async function check() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`${apiUrl}/projects/${project.id}`, { credentials: "include", cache: "no-store" });
        if (!active) return;
        if ([401, 403, 404].includes(response.status)) { window.location.replace("/projects"); return; }
        if (!response.ok) return;
        const result = await response.json() as { project: ProjectDetail };
        if (active && result.project.accessRevision !== project.accessRevision) {
          // Discard stale local inputs rather than submitting them after a transfer.
          window.location.replace(`/projects/${project.id}`);
        }
      } catch { /* Temporary network failures do not grant additional permissions. */ }
    }
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { active = false; window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [project.id, project.accessRevision]);
  return <ProjectReadonly.Provider value={readOnly}>{children}</ProjectReadonly.Provider>;
}
