"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <Label className="field-label" htmlFor="identifier">
        手机号 / 账号
      </Label>
      <Input
        autoComplete="username"
        className="text-input"
        id="identifier"
        name="identifier"
        placeholder="请输入手机号或账号"
        required
      />

      <Label className="field-label" htmlFor="password">
        密码
      </Label>
      <Input
        autoComplete="current-password"
        className="text-input"
        id="password"
        name="password"
        placeholder="请输入登录密码"
        required
        type="password"
      />

      <div className="remember-row">
        <label className="remember-control" htmlFor="rememberMe">
          <Checkbox id="rememberMe" name="rememberMe" />
          <span>记住登录状态</span>
        </label>
        <span className="login-help">忘记密码？联系管理员</span>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <Button className="login-button" disabled={isSubmitting}>
        {isSubmitting ? "正在登录…" : "登录"}
      </Button>
    </form>
  );
}
