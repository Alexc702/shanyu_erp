"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiUrl } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function logout() {
    setIsPending(true);
    try {
      await fetch(`${apiUrl}/auth/logout`, {
        credentials: "include",
        method: "POST",
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button className="logout-button" disabled={isPending} onClick={logout}>
      {isPending ? "退出中…" : "退出登录"}
    </button>
  );
}
