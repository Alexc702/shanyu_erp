"use client";

import type {
  HalfPackageQuotation,
  HalfPackageQuotationStatus,
} from "@shanyu/contracts";
import { Check, ChevronDown, PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  continueEditingQuotation,
  formatQuotationMoney,
  updateQuotationAdjustment,
} from "@/lib/quotation-client";

const adjustedTotalEvent = "shanyu:quotation-adjusted-total";

export function QuotationLiveAmount({
  initialAmount,
  quotationId,
}: {
  readonly initialAmount: string;
  readonly quotationId: string;
}) {
  const [amount, setAmount] = useState(initialAmount);

  useEffect(() => {
    function update(event: Event) {
      const detail = (event as CustomEvent<{
        amount: string;
        quotationId: string;
      }>).detail;
      if (detail.quotationId === quotationId) setAmount(detail.amount);
    }
    window.addEventListener(adjustedTotalEvent, update);
    return () => window.removeEventListener(adjustedTotalEvent, update);
  }, [quotationId]);

  return <>{formatProjectMoney(amount)}</>;
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
    String(Number(initialQuotation.discountRate) * 100),
  );
  const [writeOff, setWriteOff] = useState(String(Number(initialQuotation.writeOff)));
  const [reason, setReason] = useState(initialQuotation.adjustmentReason ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const total = Number(initialQuotation.total);
  const percent = Number(discountPercent);
  const writeOffAmount = Number(writeOff || "0");
  const validAdjustment =
    Number.isFinite(percent) &&
    percent >= 0 &&
    percent <= 100 &&
    /^\d{1,3}(?:\.\d{0,2})?$/.test(discountPercent) &&
    Number.isFinite(writeOffAmount) &&
    writeOffAmount >= 0 &&
    /^\d*(?:\.\d{0,2})?$/.test(writeOff);
  const discountedTotal = validAdjustment ? total * (percent / 100) : total;
  const discountSavings = Math.max(0, total - discountedTotal);
  const writeOffSavings = validAdjustment
    ? Math.min(writeOffAmount, discountedTotal)
    : 0;
  const adjustedTotal = Math.max(0, discountedTotal - writeOffSavings);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(adjustedTotalEvent, {
      detail: {
        amount: adjustedTotal.toFixed(4),
        quotationId: initialQuotation.id,
      },
    }));
  }, [adjustedTotal, initialQuotation.id]);

  function requestConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAdjustment) {
      setMessage("折扣须为 0–100 且最多两位小数；抹零须为非负金额");
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
    const percent = Number(discountPercent);
    setBusy(true);
    setMessage(null);
    try {
      await updateQuotationAdjustment(projectId, initialQuotation.id, {
        action:
          mode === "OWNER_CONFIRM" ? "CONFIRM" : "SUBMIT_FOR_APPROVAL",
        discountRate: (percent / 100).toFixed(4),
        expectedRevision: initialQuotation.revision,
        reason: reason.trim() || null,
        writeOff: Number(writeOff || "0").toFixed(4),
      });
      setConfirmationOpen(false);
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="border-border py-0 shadow-none">
        <CardContent className="grid gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="type-section-title">半包折扣与抹零</h2>
            <p className="type-support m-0 text-muted-foreground">
              {mode === "PENDING"
                ? "已提交何老板审批；审批期间不可再次调整或导出"
                : "输入后实时计算；提交时须填写调整原因"}
            </p>
          </div>
          <div className="grid gap-1 text-right">
            <span className="type-support text-muted-foreground">折后项目报价</span>
            <strong className="text-xl">
              ¥{formatQuotationMoney(adjustedTotal.toFixed(4))}
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
                <span>模块原价</span>
                <div className="flex h-10 items-center rounded-md bg-muted px-3 type-body font-medium">
                  ¥{formatQuotationMoney(initialQuotation.total)}
                </div>
              </div>
              <label className="grid gap-1 type-table-head">
                折扣（%）
                <DiscountPercentControl
                  disabled={busy || mode === "PENDING"}
                  onChange={setDiscountPercent}
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
                  ¥{formatQuotationMoney(adjustedTotal.toFixed(4))}
                </div>
              </div>
            </div>
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
                ¥{formatQuotationMoney(adjustedTotal.toFixed(4))}
              </strong>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-3">
              <span className="text-muted-foreground">折扣优惠</span>
              <strong>¥{formatQuotationMoney(discountSavings.toFixed(4))}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">抹零优惠</span>
              <strong>¥{formatQuotationMoney(writeOffSavings.toFixed(4))}</strong>
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

function DiscountPercentControl({
  disabled,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Input
        className="pr-9"
        disabled={disabled}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label="选择常用折扣"
            className="absolute right-0 top-0 h-9 w-9"
            disabled={disabled}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-28 p-1">
          {["95", "98"].map((option) => (
            <Button
              className="w-full justify-between"
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              type="button"
              variant="ghost"
            >
              {option}
              {value === option ? <Check /> : null}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function formatProjectMoney(value: string): string {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(value));
}
