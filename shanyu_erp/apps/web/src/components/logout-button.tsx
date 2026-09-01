"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { apiUrl } from "@/lib/api-url";

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
    <button
      aria-label={isPending ? "退出中" : "退出登录"}
      className="logout-button"
      disabled={isPending}
      onClick={logout}
      title="退出登录"
      type="button"
    >
      <LogOut aria-hidden="true" size={15} />
    </button>
  );
}
