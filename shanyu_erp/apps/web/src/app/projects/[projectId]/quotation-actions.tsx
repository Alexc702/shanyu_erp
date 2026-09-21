"use client";

import type {
  HalfPackageQuotation,
  HalfPackageQuotationStatus,
} from "@shanyu/contracts";
import { PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  continueEditingQuotation,
  discountRateToWholePercent,
  formatQuotationMoney,
  isValidDiscountPercent,
  updateQuotationAdjustment,
} from "@/lib/quotation-client";

export function QuotationLiveAmount({
  initialAmount,
}: {
  readonly initialAmount: string;
  readonly quotationId: string;
}) {
  return <>{formatProjectMoney(initialAmount)}</>;
}

export function ContinueEditingButton({
  display = "button",
  projectId,
  quotationId,
  status,
}: {
  readonly display?: "button" | "link";
  readonly projectId: string;
  readonly quotationId: string;
  readonly status: HalfPackageQuotationStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueEditing() {
    setBusy(true);
    setError(null);
    try {
      await continueEditingQuotation(projectId, quotationId);
      router.push(`/projects/${projectId}/quotation`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法继续编辑");
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          className={display === "link" ? "h-auto p-0" : undefined}
          variant={display === "link" ? "link" : "outline"}
        >
          {display === "button" ? <PencilLine /> : null}
          {display === "link" ? "继续编辑半包 →" : "继续编辑"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认继续编辑？</AlertDialogTitle>
          <AlertDialogDescription>
            {status === "QUOTED"
              ? "继续编辑将使当前已生成报价单失效，修改后需再次确认生成报价单。"
              : "继续编辑将根据当前已退回版本建立新草稿，并保留原折扣与抹零；修改工程项后需再次确认生成报价单。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="type-support text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={() => void continueEditing()}>
            {busy ? "正在建立草稿…" : "确认并继续编辑"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function QuotationAdjustment({
  initialQuotation,
  mode,
  projectId,
}: {
  readonly initialQuotation: HalfPackageQuotation;
  readonly mode: "DESIGNER_SUBMIT" | "OWNER_CONFIRM" | "PENDING";
  readonly projectId: string;
}) {
  const router = useRouter();
  const [discountPercent, setDiscountPercent] = useState(
    discountRateToWholePercent(initialQuotation.discountRate),
  );
  const [writeOff, setWriteOff] = useState(String(Number(initialQuotation.writeOff)));
  const [materialPercent, setMaterialPercent] = useState(discountRateToWholePercent(initialQuotation.mainMaterialAdjustment?.discountRate ?? "1.0000"));
  const [materialWriteOff, setMaterialWriteOff] = useState(initialQuotation.mainMaterialAdjustment?.writeOff ?? "0");
  const [reason, setReason] = useState(initialQuotation.adjustmentReason ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const total = previewUnits(initialQuotation.halfPackageTotal ?? initialQuotation.total);
  const validDiscountPercent = isValidDiscountPercent(discountPercent);
  const validAdjustment =
    validDiscountPercent && isValidDiscountPercent(materialPercent) && /^\d+(?:\.\d{1,4})?$/.test(materialWriteOff) &&
    /^\d+(?:\.\d{1,2})?$/.test(writeOff);
  const discountedTotal = validAdjustment ? (total * BigInt(discountPercent) + BigInt(50)) / BigInt(100) : total;
  const materialBase = previewUnits(initialQuotation.mainMaterialTotal ?? "0");
  const materialDiscounted = validAdjustment ? (materialBase * BigInt(materialPercent) + BigInt(50)) / BigInt(100) : materialBase;
  const halfAdjusted = positive(discountedTotal - (validAdjustment ? previewUnits(writeOff) : BigInt(0)));
  const materialAdjusted = positive(materialDiscounted - (validAdjustment ? previewUnits(materialWriteOff) : BigInt(0)));
  const halfAdjustedTotal = previewDecimal(halfAdjusted);
  const materialAdjustedTotal = previewDecimal(materialAdjusted);
  const discountSavings = previewDecimal(total - discountedTotal + materialBase - materialDiscounted);
  const writeOffSavings = previewDecimal(discountedTotal - halfAdjusted + materialDiscounted - materialAdjusted);
  const adjustedTotal = previewDecimal(halfAdjusted + materialAdjusted + previewUnits(initialQuotation.designFeeAmount ?? "0"));

  function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAdjustment) {
      setMessage("折扣须为 0–100 的整数；抹零须为非负金额");
      return;
    }
    if (previewUnits(writeOff) > discountedTotal || previewUnits(materialWriteOff) > materialDiscounted) {
      setMessage("抹零不能超过对应模块的折后金额");
      return;
    }
    setMessage(null);
    setConfirmationOpen(true);
  }

  async function submitAdjustment() {
    if (!reason.trim()) {
      setMessage("请填写调整原因后再提交");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await updateQuotationAdjustment(projectId, initialQuotation.id, {
        action:
          mode === "OWNER_CONFIRM" ? "CONFIRM" : "SUBMIT_FOR_APPROVAL",
        discountRate: previewDecimal(BigInt(discountPercent) * BigInt(100)),
        mainMaterialAdjustment: { discountRate: previewDecimal(BigInt(materialPercent) * BigInt(100)), writeOff: materialWriteOff },
        expectedRevision: initialQuotation.revision,
        reason: reason.trim() || null,
        writeOff: previewDecimal(previewUnits(writeOff)),
      });
      setConfirmationOpen(false);
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "PENDING" && !initialQuotation.mainMaterialAdjustment) {
    return <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-3 p-4">
      <h2 className="type-section-title">折扣与抹零 · 历史整体优惠方案</h2>
      <p className="type-support text-muted-foreground">此申请按原版本半包与主材合计计算优惠，不拆分为独立模块优惠；审批期间只读，原金额保持不变。</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <span>整体折扣 {discountPercent}%</span>
        <span>整体抹零 ¥{formatQuotationMoney(initialQuotation.writeOff)}</span>
        <strong>待审批项目报价 ¥{formatQuotationMoney(initialQuotation.adjustedTotal)}</strong>
      </div>
      <p className="type-support">调整原因：{initialQuotation.adjustmentReason || "未填写"}</p>
    </CardContent></Card>;
  }

  return (
    <>
      <Card className="border-border py-0 shadow-none">
        <CardContent className="grid gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="type-section-title">折扣与抹零 · 待审批方案预览</h2>
            <p className="type-support m-0 text-muted-foreground">
              {mode === "PENDING"
                ? "已提交何老板审批；审批期间不可再次调整或导出"
                : "输入后实时计算；提交时须填写调整原因"}
            </p>
          </div>
          <div className="grid gap-1 text-right">
            <span className="type-support text-muted-foreground">折后项目报价</span>
            <strong className="text-xl">
              ¥{formatQuotationMoney(mode === "PENDING" ? initialQuotation.adjustedTotal : adjustedTotal)}
            </strong>
          </div>
        </div>
          <form
            className="grid gap-3"
            id="quotation-adjustment-form"
            onSubmit={requestConfirmation}
          >
            <div className="grid items-end gap-3 md:grid-cols-[minmax(180px,1fr)_96px_118px_minmax(180px,1fr)]">
              <div className="grid gap-1 type-table-head">
                <span>半包原价</span>
                <div className="flex h-10 items-center rounded-md bg-muted px-3 type-body font-medium">
                  ¥{formatQuotationMoney(initialQuotation.halfPackageTotal ?? initialQuotation.total)}
                </div>
              </div>
              <label className="grid gap-1 type-table-head">
                折扣（%）
                <Input
                  aria-invalid={discountPercent !== "" && !validDiscountPercent}
                  disabled={busy || mode === "PENDING"}
                  inputMode="numeric"
                  max="100"
                  min="0"
                  onChange={(event) => {
                    if (/^\d*$/.test(event.target.value)) {
                      setDiscountPercent(event.target.value);
                    }
                  }}
                  placeholder="0–100"
                  step="1"
                  type="number"
                  value={discountPercent}
                />
              </label>
              <label className="grid gap-1 type-table-head">
                抹零（元）
                <Input
                  disabled={busy || mode === "PENDING"}
                  inputMode="decimal"
                  onChange={(event) => setWriteOff(event.target.value)}
                  value={writeOff}
                />
              </label>
              <div className="grid gap-1 type-table-head">
                <span>折后报价</span>
                <div className="flex h-10 items-center rounded-md bg-primary-soft px-3 type-body font-semibold text-primary">
                  ¥{formatQuotationMoney(halfAdjustedTotal)}
                </div>
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" className="justify-self-end" disabled={busy || mode === "PENDING"} onClick={() => { setDiscountPercent("100"); setWriteOff("0"); }}>半包恢复无优惠</Button>
            <div className="grid items-end gap-3 md:grid-cols-[minmax(180px,1fr)_96px_118px_minmax(180px,1fr)]">
              <div className="grid gap-1 type-table-head"><span>主材原价</span><div className="flex h-10 items-center rounded-md bg-muted px-3">¥{formatQuotationMoney(initialQuotation.mainMaterialTotal ?? "0")}</div></div>
              <label className="grid gap-1 type-table-head">主材折扣（%）<Input disabled={busy || mode === "PENDING"} inputMode="numeric" min="0" max="100" step="1" value={materialPercent} onChange={e => { if (/^\d*$/.test(e.target.value)) setMaterialPercent(e.target.value); }} /></label>
              <label className="grid gap-1 type-table-head">主材抹零（元）<Input disabled={busy || mode === "PENDING"} inputMode="decimal" value={materialWriteOff} onChange={e => setMaterialWriteOff(e.target.value)} /></label>
              <div className="grid gap-1 type-table-head"><span>主材折后报价</span><div className="flex h-10 items-center rounded-md bg-primary-soft px-3 text-primary">¥{formatQuotationMoney(materialAdjustedTotal)}</div></div>
            </div>
            <Button type="button" size="sm" variant="outline" className="justify-self-end" disabled={busy || mode === "PENDING"} onClick={() => { setMaterialPercent("100"); setMaterialWriteOff("0"); }}>主材恢复无优惠</Button>
            {!validAdjustment && mode !== "PENDING" ? <p role="alert" className="type-support text-destructive">请完整填写 0–100 的整数折扣及非负抹零金额；当前预览不作为有效提交值。</p> : null}
            <label className="grid gap-1 type-table-head">
              调整原因（必填）
              <Input
                disabled={busy || mode === "PENDING"}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
                placeholder="请填写客户沟通背景或价格调整说明"
                required
                value={reason}
              />
            </label>
            {message ? (
              <span className="type-support text-destructive" role="alert">
                {message}
              </span>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setConfirmationOpen} open={confirmationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "OWNER_CONFIRM" ? "确认折扣" : "提交折扣审批"}
            </DialogTitle>
            <DialogDescription>
              {mode === "OWNER_CONFIRM"
                ? "确认金额变化后立即生效，并恢复打印/导出。"
                : "确认金额变化后提交何老板审批；提交后进入审批中。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 rounded-lg border border-border p-4 type-body">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">调整前</span>
              <strong>¥{formatQuotationMoney(initialQuotation.total)}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">调整后</span>
              <strong className="text-primary">
                ¥{formatQuotationMoney(adjustedTotal)}
              </strong>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-3">
              <span className="text-muted-foreground">折扣优惠</span>
              <strong>¥{formatQuotationMoney(discountSavings)}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">抹零优惠</span>
              <strong>¥{formatQuotationMoney(writeOffSavings)}</strong>
            </div>
            <div className="grid gap-1 border-t border-border pt-3">
              <span className="text-muted-foreground">调整原因（必填）</span>
              <span className={reason.trim() ? "" : "text-destructive"}>
                {reason.trim() || "未填写，暂不能提交"}
              </span>
            </div>
          </div>
          {message ? <p className="type-support text-destructive">{message}</p> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={busy} variant="outline">取消</Button>
            </DialogClose>
            <Button
              disabled={busy || !reason.trim()}
              onClick={() => void submitAdjustment()}
            >
              {busy
                ? "提交中…"
                : mode === "OWNER_CONFIRM"
                  ? "确认折扣"
                  : "确认提交审批"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatProjectMoney(value: string): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function previewUnits(value: string): bigint {
  const [whole, fraction = ""] = (value || "0").split(".");
  return BigInt(whole || "0") * BigInt(10000) + BigInt(fraction.padEnd(4, "0"));
}
function previewDecimal(value: bigint): string { return `${value / BigInt(10000)}.${(value % BigInt(10000)).toString().padStart(4, "0")}`; }
function positive(value: bigint): bigint { return value > BigInt(0) ? value : BigInt(0); }
