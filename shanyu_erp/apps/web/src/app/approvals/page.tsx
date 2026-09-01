import type { HalfPackageApprovalSummary } from "@shanyu/contracts";
import { ChevronDown } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  fetchPendingApprovals,
  fetchProjects,
  fetchSession,
} from "@/lib/api-client";
import { formatQuotationMoney } from "@/lib/quotation-client";

export default async function ApprovalsPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (session.user.role !== "OWNER") notFound();
  const [quotations, projects] = await Promise.all([
    fetchPendingApprovals(cookieHeader),
    fetchProjects(cookieHeader),
  ]);
  if (!quotations || !projects) notFound();

  return (
    <AppShell active="approvals" user={session.user}>
      <main className="compact-workflow-page workflow-page">
        <header className="centered-workflow-header workflow-header">
          <div className="grid gap-1">
            <h1 className="type-page-title">报价审批</h1>
            <p className="type-body">查看全部待定价、待审批及异常版本</p>
          </div>
          <Badge className="px-2 py-1" variant="warning">
            {quotations.length} 项待处理
          </Badge>
        </header>

        <div className="flex flex-wrap gap-2" aria-label="审批筛选">
          {[
            "全部状态",
            "全部主案设计师",
            "是否有异常",
            "提交时间",
          ].map((label) => (
            <Button
              className="h-9 border-border px-3 font-normal text-muted-foreground"
              key={label}
              variant="outline"
            >
              {label}
              <ChevronDown className="size-3.5" />
            </Button>
          ))}
        </div>

        <Card className="overflow-hidden border-border shadow-none">
          <div className="min-w-[900px]">
            {quotations.map((quotation) => {
              const project = projects.find(
                (candidate) => candidate.id === quotation.projectId,
              );
              return (
                <ApprovalRow
                  key={quotation.id}
                  leadDesignerName={project?.leadDesigner.displayName ?? "—"}
                  quotation={quotation}
                />
              );
            })}
            {quotations.length === 0 ? (
              <div className="type-body flex h-40 items-center justify-center text-muted-foreground">
                当前没有待审批报价
              </div>
            ) : null}
          </div>
        </Card>
      </main>
    </AppShell>
  );
}

function ApprovalRow({
  leadDesignerName,
  quotation,
}: {
  readonly leadDesignerName: string;
  readonly quotation: HalfPackageApprovalSummary;
}) {
  const status = approvalStatus(quotation.status);
  return (
    <div className="grid grid-cols-[250px_110px_300px_140px_minmax(120px,1fr)] items-center gap-3 border-b border-border p-4 last:border-b-0">
      <div className="grid gap-1">
        <strong className="type-entity">{quotation.projectName}</strong>
        <span className="type-support text-muted-foreground">
          {leadDesignerName} · V{quotation.versionNumber}
        </span>
      </div>
      <Badge variant={status.variant}>{status.label}</Badge>
      <span className="type-action text-success">无阻断</span>
      <strong className="type-entity">¥{displayMoney(quotation.salesAmount)}</strong>
      <Link
        className="type-action text-primary hover:underline"
        href={`/approvals/${quotation.id}`}
      >
        查看详情 →
      </Link>
    </div>
  );
}

function approvalStatus(status: HalfPackageApprovalSummary["status"]): {
  readonly label: string;
  readonly variant:
    | "default"
    | "destructive"
    | "secondary"
    | "success"
    | "warning";
} {
  if (status === "PENDING_APPROVAL") {
    return { label: "待审批", variant: "default" };
  }
  if (status === "PENDING_PRICING" || status === "PENDING_SUPPLEMENT") {
    return { label: status === "PENDING_PRICING" ? "待定价" : "待补充", variant: "warning" };
  }
  if (status === "RETURNED") return { label: "已退回", variant: "destructive" };
  return { label: status === "APPROVED" ? "已审批" : "已处理", variant: "success" };
}

function displayMoney(value: string | null): string {
  return formatQuotationMoney(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
