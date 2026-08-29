import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchHalfPackageCostMargin, fetchSession } from "@/lib/api-client";
import {
  formatMarginRate,
  marginStatus,
  orderCostMarginScopes,
} from "@/lib/cost-margin-view-model";
import { formatQuotationMoney } from "@/lib/quotation-client";
import { formatQuotationScopeName } from "@/lib/quotation-view-model";

interface CostMarginPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function CostMarginPage({ params }: CostMarginPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  if (session.user.role !== "OWNER") {
    notFound();
  }
  const { projectId } = await params;
  const costMargin = await fetchHalfPackageCostMargin(cookieHeader, projectId);
  if (!costMargin) {
    notFound();
  }
  const scopes = orderCostMarginScopes(costMargin.scopes);

  return (
    <AppShell active="cost-margin" user={session.user}>
      <main className="cost-margin-page">
        <header className="cost-margin-header">
          <div>
            <nav className="quotation-breadcrumb" aria-label="面包屑">
              <Link href={`/projects/${projectId}`}>{costMargin.projectName}</Link>
              <span>/</span>
              <Link href={`/projects/${projectId}/quotation`}>半包报价</Link>
              <span>/</span>
              <strong>预计成本毛利</strong>
            </nav>
            <h1>{costMargin.projectName} · 半包预计成本毛利</h1>
            <p>仅何老板可见；一期均为预计口径，不与后续实际财务混用</p>
          </div>
          <div className="cost-margin-actions">
            <Badge variant="destructive">老板专属</Badge>
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}/quotation/cost-margin/details`}>
                查看工程项成本明细
              </Link>
            </Button>
          </div>
        </header>

        <section className="cost-metric-grid" aria-label="半包预计毛利摘要">
          <CostMetric
            label="销售金额"
            note="已选有效工程项"
            value={`¥ ${formatQuotationMoney(costMargin.salesAmount)}`}
          />
          <CostMetric
            label="预计成本"
            note={`成本单价快照 · 主材库 V${costMargin.costVersion.versionNumber}`}
            value={`¥ ${formatQuotationMoney(costMargin.expectedCost)}`}
          />
          <CostMetric
            emphasis={costMargin.grossProfit.startsWith("-") ? "danger" : "success"}
            label="预计毛利"
            note="销售金额 − 预计成本"
            value={`¥ ${formatQuotationMoney(costMargin.grossProfit)}`}
          />
          <CostMetric
            emphasis={costMargin.grossProfit.startsWith("-") ? "danger" : "success"}
            label="预计毛利率"
            note="不含管理费与税金"
            value={formatMarginRate(costMargin.grossMarginRate)}
          />
        </section>

        <Card className="cost-summary-card">
          <Table className="cost-summary-table">
            <TableHeader>
              <TableRow>
                <TableHead>分区 / 空间</TableHead>
                <TableHead className="text-right">销售金额</TableHead>
                <TableHead className="text-right">预计成本</TableHead>
                <TableHead className="text-right">预计毛利</TableHead>
                <TableHead className="text-right">毛利率</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scopes.map((scope) => {
                const status = marginStatus(scope.salesAmount, scope.grossProfit);
                return (
                  <TableRow key={scope.id}>
                    <TableCell className="font-medium">
                      {formatQuotationScopeName(scope.name)}
                    </TableCell>
                    <TableCell className="text-right">¥ {formatQuotationMoney(scope.salesAmount)}</TableCell>
                    <TableCell className="text-right">¥ {formatQuotationMoney(scope.expectedCost)}</TableCell>
                    <TableCell className="text-right">¥ {formatQuotationMoney(scope.grossProfit)}</TableCell>
                    <TableCell className="text-right">{formatMarginRate(scope.grossMarginRate)}</TableCell>
                    <TableCell>
                      <Badge variant={status === "负毛利" ? "destructive" : status === "未计价" ? "secondary" : "success"}>
                        {status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        <p className="cost-security-note">
          服务端按敏感字段权限返回预计成本、预计毛利；设计师页面、接口和当前销售报价响应均不返回这些数据。
        </p>
      </main>
    </AppShell>
  );
}

function CostMetric({
  emphasis,
  label,
  note,
  value,
}: {
  readonly emphasis?: "danger" | "success";
  readonly label: string;
  readonly note: string;
  readonly value: string;
}) {
  return (
    <Card className="cost-metric-card">
      <CardContent>
        <span>{label}</span>
        <strong className={emphasis ? `cost-${emphasis}` : undefined}>{value}</strong>
        <small>{note}</small>
      </CardContent>
    </Card>
  );
}
