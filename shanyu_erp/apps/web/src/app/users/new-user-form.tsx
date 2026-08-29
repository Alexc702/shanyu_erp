"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/api-client";

export function NewUserForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    try {
      const phone = String(form.get("phone") ?? "").trim();
      const response = await fetch(`${apiUrl}/users`, {
        body: JSON.stringify({
          account: form.get("account"),
          displayName: form.get("displayName"),
          password: form.get("password"),
          phone: phone || null,
          role: form.get("role"),
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        setMessage(payload.message ?? "创建失败，请检查输入");
        return;
      }
      formElement.reset();
      setMessage("账号已创建");
      router.refresh();
    } catch {
      setMessage("暂时无法连接服务");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="new-user-form" onSubmit={handleSubmit}>
      <div className="compact-field">
        <Label htmlFor="displayName">姓名</Label>
        <Input id="displayName" name="displayName" required />
      </div>
      <div className="compact-field">
        <Label htmlFor="account">登录账号</Label>
        <Input id="account" name="account" pattern="[A-Za-z0-9._-]{3,64}" required />
      </div>
      <div className="compact-field">
        <Label htmlFor="phone">手机号（选填）</Label>
        <Input id="phone" name="phone" />
      </div>
      <div className="compact-field">
        <Label htmlFor="role">角色</Label>
        <select defaultValue="LEAD_DESIGNER" id="role" name="role">
          <option value="OWNER">老板</option>
          <option value="LEAD_DESIGNER">主案设计师</option>
          <option value="WOODWORK_DESIGNER">木作设计师</option>
          <option value="PROJECT_MANAGER">项目经理（预留）</option>
          <option value="FINANCE">财务（预留）</option>
        </select>
      </div>
      <div className="compact-field">
        <Label htmlFor="password">初始密码</Label>
        <Input id="password" minLength={8} name="password" required type="password" />
      </div>
      <div className="form-action-row">
        <span className="form-message" aria-live="polite">{message}</span>
        <Button disabled={isSubmitting}>
          {isSubmitting ? "创建中…" : "创建账号"}
        </Button>
      </div>
    </form>
  );
}
