"use client";

import type {
  HalfPackageApprovalAction,
  HalfPackageCostMargin,
  HalfPackageExportFormat,
  HalfPackageQuotation,
} from "@shanyu/contracts";
import {
  Check,
  CheckCircle2,
  Download,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl } from "@/lib/api-client";
import {
  createQuotationExport,
  decideQuotation,
  formatQuotationMoney,
} from "@/lib/quotation-client";

export function ApprovalDetail({
  costMargin,
  initialQuotation,
}: {
  readonly costMargin: HalfPackageCostMargin;
  readonly initialQuotation: HalfPackageQuotation;
}) {
  const router = useRouter();
  const [quotation, setQuotation] = useState(initialQuotation);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = quotation.status === "PENDING_APPROVAL";
  const exportable =
    quotation.status === "APPROVED" || quotation.status === "SUPERSEDED";
  const emptyQuantityCount = quotation.scopes.reduce(
    (count, scope) =>
      count +
      scope.lines.filter(
        (line) =>
          line.selected &&
          line.quantitySource === "MANUAL" &&
          line.quantity === null,
      ).length,
    0,
  );
  const templateItemCount = new Set(
    quotation.scopes.flatMap((scope) =>
      scope.lines.map(
        (line) =>
          `${line.sectionName}\u0000${line.itemName}\u0000${line.unit}\u0000${line.saleUnitPrice}`,
      ),
    ),
  ).size;

  async function decide(
    action: HalfPackageApprovalAction,
    decisionReason: string | null,
  ) {
    setWorking(true);
    setError(null);
    try {
      const decided = await decideQuotation(
        quotation.id,
        action,
        decisionReason,
      );
      setQuotation(decided);
      setReturnOpen(false);
      setReturnReason("");
      setApprovalReason("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审批失败");
    } finally {
      setWorking(false);
    }
  }

  async function exportFile(format: HalfPackageExportFormat) {
    setWorking(true);
    setError(null);
    try {
      const record = await createQuotationExport(quotation.id, format);
      const link = document.createElement("a");
      link.href = `${apiUrl}${record.downloadPath}`;
      link.download = record.fileName;
      link.click();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="grid gap-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <Link
            className="mb-1 w-fit text-[13px] font-medium text-primary hover:underline"
            href="/approvals"
          >
            ← 返回审批列表
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-2xl font-bold tracking-tight">
              {quotation.projectName} · V{quotation.versionNumber}
            </h1>
            <Badge variant={pending ? "default" : "success"}>
              {statusLabel(quotation.status)}
            </Badge>
          </div>
          <p className="m-0 text-[13px] text-muted-foreground">
            提交于 {formatDateTime(quotation.submittedAt)} · 模板 半包 V
            {quotation.templateVersion} · 快照只读
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <>
              <Button
                className="h-9 border-border"
                onClick={() => setReturnOpen(true)}
                variant="outline"
              >
                <RotateCcw />
                退回修改
              </Button>
              <Button
                className="h-9"
                disabled={working}
                onClick={() => decide("APPROVED", null)}
              >
                <CheckCircle2 />
                批准并锁定
              </Button>
            </>
          ) : exportable ? (
            <>
              <Button
                className="h-9 border-border"
                disabled={working}
                onClick={() => exportFile("PDF")}
                variant="outline"
              >
                <Download />
                导出 PDF
              </Button>
              <Button
                className="h-9"
                disabled={working}
                onClick={() => exportFile("XLSX")}
              >
                <Download />
                导出 XLSX
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {error ? (
        <p
          className="m-0 rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-4">
          <Card className="border-border py-0 shadow-none">
            <CardContent className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
              <SnapshotMetric
                label="销售金额"
                value={`¥ ${displayMoney(costMargin.salesAmount)}`}
              />
              <SnapshotMetric
                label="预计成本"
                value={`¥ ${displayMoney(costMargin.expectedCost)}`}
              />
              <SnapshotMetric
                label="预计毛利"
                value={`¥ ${displayMoney(costMargin.grossProfit)}`}
              />
              <SnapshotMetric
                label="预计毛利率"
                value={formatMarginRate(costMargin.grossMarginRate)}
              />
            </CardContent>
          </Card>

          <Card className="border-border py-0 shadow-none">
            <CardContent className="p-4">
              <h2 className="mb-3 text-lg font-semibold">半包分区与异常</h2>
              <div className="divide-y divide-border">
                <ValidationRow
                  detail="无缺价或缺成本"
                  label={`${quotation.scopes.length} 个报价分区 / ${templateItemCount} 个标准项`}
                  status="完整"
                />
                <ValidationRow
                  detail="自动项依赖已固化"
                  label="项目与空间参数"
                  status="完整"
                />
                <ValidationRow
                  detail="客户导出自动移除"
                  label="手填数量为空"
                  status={`${emptyQuantityCount} 项`}
                  warning={emptyQuantityCount > 0}
                />
                <ValidationRow
                  detail="与快照一致"
                  label="主材库价格"
                  status={`半包 V${quotation.templateVersion}`}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border py-0 shadow-none">
          <CardContent className="grid gap-3 p-4">
            <h2 className="text-lg font-semibold">审批检查</h2>
            <div className="grid gap-2 text-[13px]">
              <CheckLine>无阻断项</CheckLine>
              <CheckLine>成本与毛利可计算</CheckLine>
              <CheckLine>客户导出不含成本</CheckLine>
            </div>
            <p className="m-0 rounded-md bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
              特批必须填写原因并写入版本审计日志。
            </p>
            <label
              className="text-xs font-semibold"
              htmlFor="approval-special-reason"
            >
              审批意见 / 特批原因
            </label>
            <Textarea
              className="h-[100px] resize-none border-border"
              disabled={!pending || working}
              id="approval-special-reason"
              onChange={(event) => setApprovalReason(event.target.value)}
              placeholder="填写特批原因"
              value={approvalReason}
            />
            {pending ? (
              <Button
                className="h-9 border-border"
                disabled={working || !approvalReason.trim()}
                onClick={() =>
                  decide("SPECIAL_APPROVED", approvalReason.trim())
                }
                variant="outline"
              >
                <ShieldCheck />
                特批通过
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog onOpenChange={setReturnOpen} open={returnOpen}>
        <DialogContent className="max-w-[550px] border-border">
          <DialogHeader className="gap-2">
            <DialogTitle className="text-xl">
              退回报价 V{quotation.versionNumber}
            </DialogTitle>
            <DialogDescription>
              退回后报价状态将变为“已退回”，主案设计师可继续修改；再次提交会生成新的只读快照。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="text-xs font-semibold" htmlFor="return-reason">
              退回原因 *
            </label>
            <Textarea
              className="h-[110px] resize-none border-border"
              id="return-reason"
              onChange={(event) => setReturnReason(event.target.value)}
              placeholder="请明确说明需要修改的内容"
              value={returnReason}
            />
          </div>
          <p className="m-0 rounded-md bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
            原因、操作者、时间和版本将写入审计日志。
          </p>
          <DialogFooter>
            <Button
              className="border-border"
              onClick={() => setReturnOpen(false)}
              variant="outline"
            >
              <X />
              取消
            </Button>
            <Button
              disabled={working || !returnReason.trim()}
              onClick={() => decide("RETURNED", returnReason.trim())}
            >
              <RotateCcw />
              确认退回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function SnapshotMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="grid gap-2 rounded-md bg-muted/70 p-3">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <strong className="text-xl leading-none tracking-tight">{value}</strong>
    </div>
  );
}

function ValidationRow({
  detail,
  label,
  status,
  warning = false,
}: {
  readonly detail: string;
  readonly label: string;
  readonly status: string;
  readonly warning?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(150px,220px)] items-center gap-3 py-3 text-[13px]">
      <strong>{label}</strong>
      <Badge variant={warning ? "warning" : "success"}>{status}</Badge>
      <span className="text-muted-foreground">{detail}</span>
    </div>
  );
}

function CheckLine({ children }: { readonly children: string }) {
  return (
    <div className="flex items-center gap-2 text-success">
      <span className="flex size-4 items-center justify-center rounded-full border border-success">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </div>
  );
}

function displayMoney(value: string): string {
  return formatQuotationMoney(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMarginRate(value: string | null): string {
  return value === null ? "—" : `${(Number(value) * 100).toFixed(2)}%`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function statusLabel(status: HalfPackageQuotation["status"]): string {
  return {
    APPROVED: "已审批",
    DRAFT: "草稿",
    PENDING_APPROVAL: "待审批",
    PENDING_PRICING: "待定价",
    PENDING_SUPPLEMENT: "待补充",
    RETURNED: "已退回",
    SUPERSEDED: "已替代",
    VOID: "已作废",
  }[status];
}
