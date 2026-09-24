"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Lists and workbench counts must not retain another tab's old project access.
export function ProjectPermissionRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return null;
}
