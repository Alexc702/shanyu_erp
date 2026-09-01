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
import { hasOwnerPermissions } from "@/lib/permissions";
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
  if (!hasOwnerPermissions(session.user.role)) {
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
      <main className="grid gap-4 p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1">
            <nav className="quotation-breadcrumb" aria-label="面包屑">
              <Link href={`/projects/${projectId}`}>{costMargin.projectName}</Link>
              <span>/</span>
              <Link href={`/projects/${projectId}/quotation`}>半包报价</Link>
              <span>/</span>
              <strong>预计成本毛利</strong>
            </nav>
            <h1 className="type-page-title m-0 tracking-tight">
              {costMargin.projectName} · 半包预计成本毛利
            </h1>
            <p className="type-body m-0 text-muted-foreground">
              一期均为预计口径，不与后续实际财务混用
            </p>
          </div>
          <Button asChild className="h-9 border-border" variant="outline">
            <Link href={`/projects/${projectId}/quotation/cost-margin/details`}>
              查看工程项成本明细
            </Link>
          </Button>
        </header>

        <section
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="半包预计毛利摘要"
        >
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

        <Card className="overflow-hidden border-border py-0 shadow-none">
          <Table className="min-w-[900px]">
            <colgroup>
              <col className="w-[260px]" />
              <col className="w-[160px]" />
              <col className="w-[160px]" />
              <col className="w-[160px]" />
              <col className="w-[120px]" />
              <col />
            </colgroup>
            <TableHeader>
              <TableRow className="border-border bg-muted/70 hover:bg-muted/70">
                <TableHead className="h-11 px-4">分区 / 空间</TableHead>
                <TableHead className="h-11 px-4 text-left">销售金额</TableHead>
                <TableHead className="h-11 px-4 text-left">预计成本</TableHead>
                <TableHead className="h-11 px-4 text-left">预计毛利</TableHead>
                <TableHead className="h-11 px-4 text-left">毛利率</TableHead>
                <TableHead className="h-11 px-4">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scopes.map((scope) => {
                const status = marginStatus(scope.salesAmount, scope.grossProfit);
                return (
                  <TableRow className="border-border" key={scope.id}>
                    <TableCell className="h-[54px] px-4 font-medium">
                      {formatQuotationScopeName(scope.name)}
                    </TableCell>
                    <TableCell className="px-4 text-left">
                      ¥ {displayMoney(scope.salesAmount)}
                    </TableCell>
                    <TableCell className="px-4 text-left">
                      ¥ {displayMoney(scope.expectedCost)}
                    </TableCell>
                    <TableCell className="px-4 text-left font-semibold">
                      ¥ {displayMoney(scope.grossProfit)}
                    </TableCell>
                    <TableCell className="px-4 text-left">
                      {formatMarginRate(scope.grossMarginRate)}
                    </TableCell>
                    <TableCell className="px-4">
                      <Badge
                        variant={
                          status === "负毛利"
                            ? "destructive"
                            : status === "未计价"
                              ? "secondary"
                              : "success"
                        }
                      >
                        {status === "已计算" ? "正常" : status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
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
    <Card className="border-border py-0 shadow-none">
      <CardContent className="grid gap-3 p-4">
        <span className="type-table-body text-muted-foreground">{label}</span>
        <strong
          className={`type-key-amount tracking-tight ${
            emphasis === "danger"
              ? "text-destructive"
              : emphasis === "success"
                ? "text-success"
                : ""
          }`}
        >
          {value}
        </strong>
        <small className="type-support text-muted-foreground">{note}</small>
      </CardContent>
    </Card>
  );
}

function displayMoney(value: string): string {
  return formatQuotationMoney(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
