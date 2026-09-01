import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAuditEvents, fetchSession } from "@/lib/api-client";

interface AuditPageProps {
  readonly searchParams: Promise<{ action?: string; result?: string }>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (session.user.role !== "ADMIN") notFound();
  const filters = await searchParams;
  const events = await fetchAuditEvents(cookieHeader, filters);
  if (!events) notFound();
  return <AppShell active="audit" user={session.user}><main className="workflow-page"><header className="workflow-header"><div><p className="eyebrow">系统管理</p><h1>操作日志</h1><p>记录关键业务动作、前后状态与原因；敏感凭据永不入库。</p></div><Badge variant="secondary">最近 {events.length} 条</Badge></header><Card><Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>操作人</TableHead><TableHead>动作</TableHead><TableHead>对象</TableHead><TableHead>结果</TableHead><TableHead>前后状态 / 原因</TableHead></TableRow></TableHeader><TableBody>{events.map((event) => <TableRow key={event.id}><TableCell>{new Date(event.occurredAt).toLocaleString("zh-CN")}</TableCell><TableCell>{event.actorDisplayName ?? "系统"}</TableCell><TableCell>{actionLabel(event.action)}</TableCell><TableCell><span>{event.targetType}</span><small className="table-subline">{event.targetId ?? "—"}</small></TableCell><TableCell><Badge variant={event.result === "SUCCESS" ? "success" : "destructive"}>{event.result === "SUCCESS" ? "成功" : "失败"}</Badge></TableCell><TableCell><code>{compactState(event.beforeValue)} → {compactState(event.afterValue)}</code>{event.reason ? <small className="table-subline">原因：{event.reason}</small> : null}</TableCell></TableRow>)}</TableBody></Table></Card></main></AppShell>;
}

function compactState(value: Readonly<Record<string, unknown>> | null): string { return value ? Object.entries(value).map(([key, item]) => `${key}=${String(item)}`).join(", ") : "—"; }
function actionLabel(action: string): string { return ({ AUTH_LOGIN: "登录", AUTH_LOGOUT: "退出登录", QUOTATION_APPROVED: "报价审批通过", QUOTATION_EXPORTED: "客户版导出", QUOTATION_LINE_UPDATED: "报价工程项更新", QUOTATION_RETURNED: "报价退回", QUOTATION_SPECIAL_APPROVED: "报价特批", QUOTATION_SUBMITTED: "报价提交", QUOTATION_VERSION_CLONED: "复制报价版本", QUOTATION_VERSION_COMPARED: "报价版本对比" } as Record<string, string>)[action] ?? action; }
