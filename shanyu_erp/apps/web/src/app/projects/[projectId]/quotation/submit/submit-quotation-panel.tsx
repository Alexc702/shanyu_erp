"use client";

import type {
  HalfPackageQuotation,
  HalfPackageQuotationLine,
  HalfPackageQuotationScope,
  HalfPackageSubmissionCheck,
} from "@shanyu/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleMinus,
  House,
  Info,
  LockKeyhole,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

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
import { formatQuotationMoney, submitQuotation } from "@/lib/quotation-client";
import {
  formatDisplayNumber,
  formatQuotationUnit,
  orderQuotationScopes,
} from "@/lib/quotation-view-model";

export function SubmitQuotationPanel({
  check,
  quotation,
}: {
  readonly check: HalfPackageSubmissionCheck;
  readonly quotation: HalfPackageQuotation;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spaces = orderQuotationScopes(quotation.scopes).filter(
    (scope) => scope.spaceType !== null,
  );
  const pricedItemCount = spaces.reduce(
    (count, scope) => count + scope.lines.filter(hasQuantity).length,
    0,
  );
  const canSubmit = check.blockerCount === 0;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await submitQuotation(quotation.projectId, quotation.revision);
      router.push(`/projects/${quotation.projectId}/quotation/versions`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败");
      setSubmitting(false);
    }
  }

  return (
    <main className="compact-workflow-page submit-quotation-page workflow-page">
      <header className="centered-workflow-header workflow-header">
        <div className="grid gap-1">
          <h1 className="type-page-title">提交半包报价</h1>
          <p className="type-body">按空间核对本次提交明细；仅展示数量不为空的工程项</p>
        </div>
        <Badge className="bg-primary-soft px-2 py-1 text-primary" variant="secondary">
          {quotation.projectName} · V{quotation.versionNumber} 草稿
        </Badge>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="报价空间" value={String(spaces.length)} />
        <MetricCard label="已计价工程项" value={String(pricedItemCount)} />
        <MetricCard
          emphasized
          label="半包销售金额"
          value={`¥${displayMoney(quotation.total)}`}
        />
        <MetricCard label="报价版本" value={`V${quotation.versionNumber} 草稿`} />
      </div>

      <div className="submit-quotation-layout">
        <section className="grid min-w-0 content-start gap-3">
          <div className="flex items-end justify-between gap-3 px-0.5 pb-0.5">
            <div className="grid gap-[3px]">
              <h2 className="type-section-title">按空间确认报价明细</h2>
              <p className="type-support text-muted-foreground">
                展开显示全部空间；仅列出数量不为空的工程项
              </p>
            </div>
            <Badge className="px-2.5 py-1" variant="secondary">
              共 {spaces.length} 个空间
            </Badge>
          </div>

          {spaces.map((scope) => (
            <SpaceSummaryCard key={scope.id} scope={scope} />
          ))}
        </section>

        <aside className="submit-quotation-sidebar grid gap-3">
          {canSubmit ? (
            <PassedCheckCard
              check={check}
              pricedItemCount={pricedItemCount}
              spaceCount={spaces.length}
            />
          ) : (
            <BlockedCheckCard
              blockers={check.blockers}
              projectId={quotation.projectId}
              pricedItemCount={pricedItemCount}
              spaceCount={spaces.length}
            />
          )}
          {canSubmit ? (
            <PassedSubmitCard
              error={error}
              onSubmit={submit}
              submitting={submitting}
              total={quotation.total}
            />
          ) : (
            <BlockedSubmitCard blockerCount={check.blockerCount} total={quotation.total} />
          )}
        </aside>
      </div>
    </main>
  );
}

function MetricCard({
  emphasized = false,
  label,
  value,
}: {
  readonly emphasized?: boolean;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <Card className="border-border shadow-none">
      <CardContent className="grid gap-1.5 p-3.5 text-left">
        <span className="type-table-body text-muted-foreground">{label}</span>
        <strong className={emphasized ? "text-xl font-semibold text-primary" : "text-xl font-semibold"}>{value}</strong>
      </CardContent>
    </Card>
  );
}

function SpaceSummaryCard({ scope }: { readonly scope: HalfPackageQuotationScope }) {
  const pricedLines = scope.lines.filter(hasQuantity);
  return (
    <Card className="overflow-hidden border-border shadow-none">
      <div className="flex items-center justify-between gap-4 px-4 py-[13px]">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-primary-soft">
            <House className="size-4 text-primary" />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <strong className="type-entity truncate">{scope.name}</strong>
            <span className="type-support text-muted-foreground">
              {pricedLines.length > 0 ? `${pricedLines.length} 项已计价` : "暂无计价项"}
            </span>
          </div>
        </div>
        <div className="grid shrink-0 gap-0.5 text-right">
          <span className="type-support text-muted-foreground">空间半包总价</span>
          <strong className="type-section-title">¥{displayMoney(scope.subtotal)}</strong>
        </div>
      </div>

      {pricedLines.length > 0 ? (
        <div className="border-t border-border">
          <Table className="type-table-body min-w-[520px] table-fixed">
            <colgroup>
              <col />
              <col className="w-[140px]" />
              <col className="w-28" />
            </colgroup>
            <TableHeader>
              <TableRow className="h-[34px] border-border bg-muted hover:bg-muted">
                <TableHead className="type-table-head h-[34px] px-4">工程项目</TableHead>
                <TableHead className="type-table-head h-[34px] px-3">数量</TableHead>
                <TableHead className="type-table-head h-[34px] px-4 text-right">单价</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricedLines.map((line) => (
                <TableRow className="h-10 border-border hover:bg-transparent" key={line.id}>
                  <TableCell className="h-10 px-4 py-0 font-medium whitespace-normal">
                    {line.itemName}
                  </TableCell>
                  <TableCell className="h-10 px-3 py-0">
                    {formatDisplayNumber(line.quantity)} {formatQuotationUnit(line.unit)}
                  </TableCell>
                  <TableCell className="h-10 px-4 py-0 text-right font-semibold">
                    ¥{displayMoney(line.saleUnitPrice)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="type-support flex h-[58px] items-center justify-center gap-2 border-t border-border text-muted-foreground">
          <CircleMinus className="size-[15px]" />
          <span>本空间暂无数量不为空的工程项</span>
        </div>
      )}
    </Card>
  );
}

function PassedCheckCard({
  check,
  pricedItemCount,
  spaceCount,
}: {
  readonly check: HalfPackageSubmissionCheck;
  readonly pricedItemCount: number;
  readonly spaceCount: number;
}) {
  return (
    <Card className="border-border shadow-none">
      <CardContent className="grid gap-3.5 p-4">
        <div className="flex items-center justify-between gap-3">
          <strong className="type-section-title">提交前检查</strong>
          <Badge variant="success">
            <CheckCircle2 className="size-3" />
            已通过
          </Badge>
        </div>
        <div className="flex items-center gap-2.5 rounded-lg bg-success-soft p-3">
          <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-success text-white">
            <Check className="size-[18px]" />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <strong className="type-entity">可以提交审批</strong>
            <span className="type-support text-muted-foreground">
              {spaceCount} 个空间已完成校验，未发现阻断问题
            </span>
          </div>
        </div>
        <div className="grid">
          <ValidationRow
            label={`${spaceCount} / ${spaceCount} 空间明细已加载`}
            status="空间完整"
          />
          <ValidationRow label={`${pricedItemCount} 项数量与单价完整`} status="数据完整" />
          <ValidationRow label="金额计算结果正常" status="计算通过" />
          <ValidationRow label="无待定价或异常工程项" last status="无阻断" />
        </div>
        {check.warningCount > 0 ? (
          <div className="type-support rounded-lg bg-warning-soft p-2.5 text-warning">
            {check.warningCount} 项无施工说明，不阻断提交。
          </div>
        ) : null}
        <InfoNotice>仅提交数量不为空的工程项；提交后生成只读快照。</InfoNotice>
      </CardContent>
    </Card>
  );
}

function BlockedCheckCard({
  blockers,
  pricedItemCount,
  projectId,
  spaceCount,
}: {
  readonly blockers: readonly string[];
  readonly pricedItemCount: number;
  readonly projectId: string;
  readonly spaceCount: number;
}) {
  return (
    <Card className="border-border shadow-none">
      <CardContent className="grid gap-3.5 p-4">
        <div className="flex items-center justify-between gap-3">
          <strong className="type-section-title">提交前检查</strong>
          <Badge variant="destructive">
            <AlertCircle className="size-3" />
            {blockers.length} 项阻断
          </Badge>
        </div>
        <div className="flex items-center gap-2.5 rounded-lg bg-destructive-soft p-3 text-destructive">
          <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-destructive text-white">
            <X className="size-[18px]" />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <strong className="type-entity">暂不可提交</strong>
            <span className="type-support">
              还有 {blockers.length} 项阻断问题，请处理完成后重新检查。
            </span>
          </div>
        </div>

        <ValidationGroupHeader
          count="3 项"
          icon={<CheckCircle2 className="size-[15px] text-success" />}
          label="已通过检查"
          variant="success"
        />
        <div className="grid">
          <ValidationRow
            label={`${spaceCount} / ${spaceCount} 空间明细已加载`}
            status="空间完整"
          />
          <ValidationRow
            label={`${pricedItemCount} 项有效报价数据完整`}
            status="数据完整"
          />
          <ValidationRow label="金额计算结果正常" last status="计算通过" />
        </div>

        <ValidationGroupHeader
          count={`${blockers.length} 项`}
          icon={<AlertCircle className="size-[15px] text-destructive" />}
          label="需要处理"
          variant="destructive"
        />
        <div className="grid rounded-[7px] bg-destructive-soft px-2.5 py-0.5" aria-label="阻断问题">
          {blockers.map((item, index) => (
            <div
              className="flex gap-2 border-b border-destructive/20 py-2 last:border-b-0"
              key={`${item}-${index}`}
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <span className="type-status text-destructive">
                {formatBlockerText(item)}
              </span>
            </div>
          ))}
        </div>
        <Button asChild className="w-full border-border" variant="outline">
          <Link href={`/projects/${projectId}/quotation`}>
            <ArrowLeft />
            返回半包报价修改
          </Link>
        </Button>
        <InfoNotice>
          数量为空表示工程项不提交；已选择但缺少必填数量的工程项会阻止提交。
        </InfoNotice>
      </CardContent>
    </Card>
  );
}

function PassedSubmitCard({
  error,
  onSubmit,
  submitting,
  total,
}: {
  readonly error: string | null;
  readonly onSubmit: () => void;
  readonly submitting: boolean;
  readonly total: string;
}) {
  return (
    <Card className="border-border shadow-none">
      <CardContent className="grid gap-3 p-4 text-left">
        <strong className="type-section-title">本次提交</strong>
        <div className="grid gap-1">
          <span className="type-support text-muted-foreground">半包销售金额</span>
          <strong className="type-key-amount">¥{displayMoney(total)}</strong>
        </div>
        <p className="type-support text-muted-foreground">
          提交至何老板审批；审批通过后可导出客户版 PDF / XLSX。
        </p>
        {error ? <p className="type-support text-destructive" role="alert">{error}</p> : null}
        <Button className="w-full" disabled={submitting} onClick={onSubmit}>
          <Send />
          {submitting ? "正在提交…" : "确认提交审批"}
        </Button>
      </CardContent>
    </Card>
  );
}

function BlockedSubmitCard({
  blockerCount,
  total,
}: {
  readonly blockerCount: number;
  readonly total: string;
}) {
  return (
    <Card className="border-border shadow-none">
      <CardContent className="grid gap-3 p-4 text-left">
        <strong className="type-section-title">本次提交</strong>
        <div className="grid gap-1">
          <span className="type-support text-muted-foreground">半包销售金额</span>
          <strong className="type-key-amount">¥{displayMoney(total)}</strong>
        </div>
        <div className="flex items-center gap-2 rounded-[7px] bg-destructive-soft p-2.5 text-destructive">
          <LockKeyhole className="size-3.5 shrink-0" />
          <span className="type-status">
            当前存在 {blockerCount} 项阻断问题，暂不能提交审批。
          </span>
        </div>
        <Button className="w-full" disabled variant="secondary">
          <LockKeyhole />
          暂不可提交
        </Button>
      </CardContent>
    </Card>
  );
}

function ValidationGroupHeader({
  count,
  icon,
  label,
  variant,
}: {
  readonly count: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly variant: "destructive" | "success";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {icon}
        <strong className="type-status">{label}</strong>
      </div>
      <Badge variant={variant}>{count}</Badge>
    </div>
  );
}

function ValidationRow({
  label,
  last = false,
  status,
}: {
  readonly label: string;
  readonly last?: boolean;
  readonly status: string;
}) {
  return (
    <div className={`flex items-center gap-2 py-2.5 ${last ? "" : "border-b border-border"}`}>
      <CheckCircle2 className="size-4 shrink-0 text-success" />
      <span className="type-table-body min-w-0 flex-1">{label}</span>
      <span className="type-status text-success">{status}</span>
    </div>
  );
}

function InfoNotice({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg bg-primary-soft p-2.5 text-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="type-support">{children}</p>
    </div>
  );
}

function hasQuantity(
  line: HalfPackageQuotationLine,
): line is HalfPackageQuotationLine & { readonly quantity: string } {
  return line.quantity !== null && line.quantity.trim() !== "";
}

function displayMoney(value: string | null): string {
  return formatQuotationMoney(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatBlockerText(value: string): string {
  return value.replaceAll("*", "×");
}
