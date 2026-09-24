"use client";

import type { HalfPackageQuotation } from "@shanyu/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatQuotationMoney, updateDesignFee } from "@/lib/quotation-client";
import { useProjectReadonly } from "./project-access";

export function DesignFee({ quotation, onPendingChange }: {
  readonly quotation: HalfPackageQuotation;
  readonly onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const [price, setPrice] = useState(quotation.designFeeUnitPrice ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const readOnly = useProjectReadonly();
  const editable = quotation.isCurrent && !readOnly;
  const confirmed = quotation.designFeeConfirmed && price === (quotation.designFeeUnitPrice ?? "");
  async function save() {
    if (!/^\d{1,10}(?:\.\d{1,4})?$/.test(price.trim())) {
      setMessage("请填写非负设计费单价（最多四位小数）；免设计费请填 0");
      return;
    }
    setBusy(true); setMessage(null);
    try {
      await updateDesignFee(quotation.projectId, price.trim(), quotation.revision, quotation.id);
      setMessage("设计费已确认，已纳入项目报价"); onPendingChange?.(false); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }
  return <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-3 p-4">
    <h2 className="type-section-title">设计费</h2>
    <p className="type-support text-muted-foreground">按外框面积计价；收入单列，不参与成本毛利、模块折扣与抹零。{readOnly ? "只读查看。" : editable ? "填写后请确认设计费，免设计费请明确填 0。" : "历史修订只读。"}</p>
    <div className="grid items-end gap-3 sm:grid-cols-3">
      <label className="grid gap-1 type-table-head">设计费单价（元/㎡）<Input disabled={!editable || busy} inputMode="decimal" value={price} placeholder="未设置" onChange={e => { setPrice(e.target.value); setMessage(null); onPendingChange?.(true); }} /></label>
      <div className="grid gap-1"><span className="type-table-head">外框面积（㎡）</span><span className="rounded-md bg-muted p-2">{quotation.designFeeArea ?? "—"}</span></div>
      <div className="grid gap-1"><span className="type-table-head">设计费金额</span><strong className="rounded-md bg-primary-soft p-2 text-primary">{quotation.designFeeAmount == null ? "未设置" : `¥${formatQuotationMoney(quotation.designFeeAmount)}`}</strong></div>
    </div>
    <p role="status" className="type-support text-muted-foreground">{busy ? "保存中…" : confirmed ? "已确认" : "待确认"}；金额为已保存结果。</p>
    {editable ? <Button className="justify-self-end" disabled={busy || Boolean(confirmed)} onClick={() => void save()}>{busy ? "保存中…" : "确认设计费"}</Button> : null}
    {message ? <p role="status" className="type-support">{message}</p> : null}
  </CardContent></Card>;
}
