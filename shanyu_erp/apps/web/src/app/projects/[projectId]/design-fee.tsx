"use client";

import type { HalfPackageQuotation } from "@shanyu/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatQuotationMoney, updateDesignFee } from "@/lib/quotation-client";

export function DesignFee({ quotation }: { readonly quotation: HalfPackageQuotation }) {
  const router = useRouter();
  const [price, setPrice] = useState(quotation.designFeeUnitPrice ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const editable = quotation.isCurrent && quotation.status === "DRAFT";
  async function save() {
    setBusy(true); setMessage(null);
    try {
      await updateDesignFee(quotation.projectId, price.trim() || null, quotation.revision);
      setMessage("设计费已保存"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }
  return <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-3 p-4">
    <h2 className="type-section-title">设计费</h2>
    <p className="type-support text-muted-foreground">按外框面积计价；不参与模块折扣与抹零。{editable ? "未填写不计入总额，填写 0 表示免设计费。" : "当前版本只读，继续编辑后可修改。"}</p>
    <div className="grid items-end gap-3 sm:grid-cols-3">
      <label className="grid gap-1 type-table-head">设计费单价（元/㎡）<Input disabled={!editable || busy} inputMode="decimal" value={price} placeholder="未设置" onChange={e => setPrice(e.target.value)} /></label>
      <div className="grid gap-1"><span className="type-table-head">外框面积（㎡）</span><span className="rounded-md bg-muted p-2">{quotation.designFeeArea ?? "—"}</span></div>
      <div className="grid gap-1"><span className="type-table-head">设计费金额</span><strong className="rounded-md bg-primary-soft p-2 text-primary">{quotation.designFeeAmount == null ? "未设置" : `¥${formatQuotationMoney(quotation.designFeeAmount)}`}</strong></div>
    </div>
    {editable ? <Button className="justify-self-end" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存设计费"}</Button> : null}
    {message ? <p role="status" className="type-support">{message}</p> : null}
  </CardContent></Card>;
}
