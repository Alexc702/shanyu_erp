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
  return <AppShell active="audit" user={session.user}><main className="workflow-page"><header className="workflow-header"><div><p className="eyebrow">系统管理</p><h1>操作日志</h1><p>仅记录登录、修改、确认、提交、审批和导出等关键业务操作。</p></div><Badge variant="secondary">最近 {events.length} 条</Badge></header><Card><Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>操作人</TableHead><TableHead>操作</TableHead><TableHead>业务对象</TableHead><TableHead>结果</TableHead></TableRow></TableHeader><TableBody>{events.map((event) => <TableRow key={event.id}><TableCell>{new Date(event.occurredAt).toLocaleString("zh-CN")}</TableCell><TableCell>{event.actorDisplayName ?? "系统"}</TableCell><TableCell>{actionLabel(event.action)}{event.reason ? <small className="table-subline">原因：{event.reason}</small> : null}</TableCell><TableCell><span>{targetLabel(event.targetType)}</span><small className="table-subline">{event.targetId ?? "—"}</small></TableCell><TableCell><Badge variant={event.result === "SUCCESS" ? "success" : "destructive"}>{event.result === "SUCCESS" ? "成功" : "失败"}</Badge></TableCell></TableRow>)}</TableBody></Table></Card></main></AppShell>;
}

function actionLabel(action: string): string { return ({ AUTH_LOGIN: "登录", AUTH_LOGOUT: "退出登录", USER_CREATED: "新建员工账号", USER_UPDATED: "修改员工账号", USER_PASSWORD_RESET: "重置员工密码", USER_DELETED: "删除员工账号", CATALOG_IMPORT_REUSED: "复用主材库导入", CATALOG_IMPORT_VALIDATED: "校验主材库导入", CATALOG_VERSION_PUBLISHED: "发布主材库版本", PROJECT_CREATED: "新建项目", SPACE_CREATED: "新增空间", SPACE_UPDATED: "修改空间", SPACE_DELETED: "删除空间", QUOTATION_ADJUSTMENT_SUBMITTED: "提交折扣审批", QUOTATION_ADJUSTMENT_CONFIRMED: "确认折扣", QUOTATION_APPROVED: "批准报价", QUOTATION_EDITING_CONTINUED: "继续编辑报价", QUOTATION_EXPORTED: "导出半包报价单", QUOTATION_GENERATED: "确认生成报价单", QUOTATION_LINE_UPDATED: "修改报价工程项", QUOTATION_RETURNED: "打回修改", QUOTATION_SCOPES_SYNCED: "同步报价空间" } as Record<string, string>)[action] ?? "其他业务操作"; }
function targetLabel(targetType: string): string { return ({ CATALOG_IMPORT_BATCH: "主材库导入批次", HALF_PACKAGE_QUOTATION: "半包报价单", HALF_PACKAGE_QUOTATION_LINE: "半包工程项", HALF_PACKAGE_TEMPLATE_VERSION: "半包模板版本", PROJECT: "项目", SESSION: "登录会话", SPACE: "项目空间", USER: "员工账号" } as Record<string, string>)[targetType] ?? "业务记录"; }
