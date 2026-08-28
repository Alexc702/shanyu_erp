"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiUrl } from "@/lib/api-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        body: JSON.stringify({
          identifier: form.get("identifier"),
          password: form.get("password"),
          rememberMe: form.get("rememberMe") === "on",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        setError(payload.message ?? "登录失败，请重试");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("暂时无法连接服务，请确认 API 已启动");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label className="field-label" htmlFor="identifier">
        账号或手机号
      </label>
      <input
        autoComplete="username"
        className="text-input"
        id="identifier"
        name="identifier"
        placeholder="请输入账号或手机号"
        required
      />

      <label className="field-label" htmlFor="password">
        密码
      </label>
      <input
        autoComplete="current-password"
        className="text-input"
        id="password"
        name="password"
        placeholder="请输入密码"
        required
        type="password"
      />

      <label className="remember-row">
        <input name="rememberMe" type="checkbox" />
        <span>30 天内保持登录</span>
      </label>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <button className="primary-button login-button" disabled={isSubmitting}>
        {isSubmitting ? "正在登录…" : "登录系统"}
      </button>
    </form>
  );
}
