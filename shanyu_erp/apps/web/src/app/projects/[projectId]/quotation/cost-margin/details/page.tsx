import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchHalfPackageCostMargin,
  fetchQuotationVersionCostMargin,
  fetchSession,
} from "@/lib/api-client";
import {
  formatMarginRate,
  orderCostMarginScopes,
} from "@/lib/cost-margin-view-model";
import { formatQuotationMoney } from "@/lib/quotation-client";
import { hasOwnerPermissions } from "@/lib/permissions";
import {
  formatDisplayNumber,
  formatQuotationScopeName,
  formatQuotationUnit,
} from "@/lib/quotation-view-model";

interface CostDetailsPageProps {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<{ quotationId?: string; scope?: string }>;
}

export default async function CostDetailsPage({
  params,
  searchParams,
}: CostDetailsPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  if (!hasOwnerPermissions(session.user.role)) {
    notFound();
  }
  const { projectId } = await params;
  const { quotationId, scope: requestedScopeId } = await searchParams;
  const costMargin = quotationId
    ? await fetchQuotationVersionCostMargin(cookieHeader, quotationId)
    : await fetchHalfPackageCostMargin(cookieHeader, projectId);
  if (!costMargin || costMargin.projectId !== projectId) {
    notFound();
  }
  const scopes = orderCostMarginScopes(costMargin.scopes);
  const activeScope =
    scopes.find((scope) => scope.id === requestedScopeId) ?? scopes[0];
  if (!activeScope) {
    notFound();
  }

  return (
    <AppShell active="cost-margin" user={session.user}>
      <main className="cost-margin-page cost-details-page">
        <header className="cost-margin-header">
          <div>
            <nav className="quotation-breadcrumb" aria-label="面包屑">
              <Link href={`/projects/${projectId}`}>{costMargin.projectName}</Link>
              <span>/</span>
              <Link href={costMarginHref(projectId, quotationId)}>预计成本毛利</Link>
              <span>/</span>
              <strong>工程项成本明细</strong>
            </nav>
            <h1>{costMargin.projectName} · 工程项成本明细</h1>
            <p>价格与成本均为报价版本快照</p>
          </div>
          <Badge variant="warning">
            V{costMargin.versionNumber} {statusLabel(costMargin.status)}
          </Badge>
        </header>

        <section className="cost-metric-grid" aria-label="工程项成本摘要">
          <CostDetailMetric label="销售金额" value={`¥ ${formatQuotationMoney(costMargin.salesAmount)}`} />
          <CostDetailMetric label="预计成本" value={`¥ ${formatQuotationMoney(costMargin.expectedCost)}`} />
          <CostDetailMetric label="预计毛利" value={`¥ ${formatQuotationMoney(costMargin.grossProfit)}`} />
          <CostDetailMetric label="毛利率" value={formatMarginRate(costMargin.grossMarginRate)} />
        </section>

        <div className="cost-detail-workbench">
          <aside className="cost-scope-nav" aria-label="分区和空间">
            <h2>分区 / 空间</h2>
            {scopes.map((scope) => (
              <Link
                className={scope.id === activeScope.id ? "active" : undefined}
                href={scopeHref(scope.id, quotationId)}
                key={scope.id}
              >
                <span>{formatQuotationScopeName(scope.name)}</span>
                <small>{scope.lines.length}项计价</small>
              </Link>
            ))}
          </aside>

          <Card className="cost-lines-card">
            <div className="cost-lines-heading">
              <div>
                <h2>{formatQuotationScopeName(activeScope.name)}</h2>
                <p>仅列数量有效项；切换空间查看对应报价分区的已计价明细</p>
              </div>
              <Badge variant="success">
                成本快照 · 主材库 V{costMargin.costVersion.versionNumber}
              </Badge>
            </div>
            {activeScope.lines.length ? (
              <Table className="cost-lines-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>工程项</TableHead>
                    <TableHead>数量</TableHead>
                    <TableHead>销售单价</TableHead>
                    <TableHead>销售金额</TableHead>
                    <TableHead>成本单价</TableHead>
                    <TableHead>成本金额</TableHead>
                    <TableHead>毛利率</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeScope.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.itemName}</TableCell>
                      <TableCell>
                        {formatDisplayNumber(line.quantity)}{formatQuotationUnit(line.unit)}
                      </TableCell>
                      <TableCell>¥ {formatQuotationMoney(line.saleUnitPrice)}</TableCell>
                      <TableCell>¥ {formatQuotationMoney(line.saleAmount)}</TableCell>
                      <TableCell>¥ {formatQuotationMoney(line.costUnitPrice)}</TableCell>
                      <TableCell>¥ {formatQuotationMoney(line.costAmount)}</TableCell>
                      <TableCell>{formatMarginRate(line.grossMarginRate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="cost-lines-empty">当前分区暂无数量有效的工程项</div>
            )}
            <p className="cost-version-note">
              销售价与成本价来自当前报价快照；修改主材库不会回写历史报价。
            </p>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}

function CostDetailMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Card className="cost-metric-card">
      <CardContent><span>{label}</span><strong>{value}</strong></CardContent>
    </Card>
  );
}

function costMarginHref(projectId: string, quotationId?: string): string {
  const base = `/projects/${projectId}/quotation/cost-margin`;
  return quotationId
    ? `${base}?quotationId=${encodeURIComponent(quotationId)}`
    : base;
}

function scopeHref(scopeId: string, quotationId?: string): string {
  const params = new URLSearchParams({ scope: scopeId });
  if (quotationId) params.set("quotationId", quotationId);
  return `?${params.toString()}`;
}

function statusLabel(status: string): string {
  return {
    APPROVED: "已审批",
    DRAFT: "草稿",
    PENDING_APPROVAL: "待审批",
    PENDING_PRICING: "待定价",
    PENDING_SUPPLEMENT: "待补充",
    RETURNED: "已退回",
    SUPERSEDED: "已替代",
    VOID: "已作废",
  }[status] ?? status;
}
