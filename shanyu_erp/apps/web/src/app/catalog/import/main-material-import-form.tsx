"use client";

import type { MainMaterialImportBatchView, MainMaterialImportMode } from "@shanyu/contracts";
import { FileCheck2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  publishMainMaterialWorkbook,
  validateMainMaterialWorkbook,
} from "@/lib/main-material-client";
import { cn } from "@/lib/utils";

export function MainMaterialImportForm({ currentItemCount, currentVersionNumber }: { readonly currentItemCount: number; readonly currentVersionNumber: number | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<MainMaterialImportMode>("FULL");
  const [batch, setBatch] = useState<MainMaterialImportBatchView | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File)) return;
    setWorking(true); setMessage(""); setBatch(null); setConfirmed(false);
    try {
      const result = await validateMainMaterialWorkbook(file, mode);
      setBatch(result);
      setMessage(result.reused ? "该文件已校验，已复用原批次。" : "Excel 校验完成。发布前请复核差异。 ");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "校验失败");
    } finally { setWorking(false); }
  }

  async function publish() {
    if (!batch || batch.status !== "VALIDATED" || !confirmed) return;
    setWorking(true); setMessage("");
    try {
      await publishMainMaterialWorkbook(batch.id);
      router.replace("/catalog?type=main");
      router.refresh();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "发布失败"); }
    finally { setWorking(false); }
  }

  return <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
    <Card className="py-0 shadow-none"><CardContent className="grid gap-4 p-5"><div><p className="eyebrow">01 · 导入方式</p><h2 className="type-section-title">上传主材库 Excel</h2><p className="type-support mb-0 mt-1 text-muted-foreground">全量更新整版快照；Delta 仅处理填写的记录与字段。</p></div><div className="grid grid-cols-2 gap-2">{(["FULL", "DELTA"] as const).map((value) => <button className={cn("rounded-lg border px-4 py-3 text-left transition-colors", mode === value ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-muted")} key={value} onClick={() => { setMode(value); setBatch(null); setConfirmed(false); }} type="button"><strong className="block">{value === "FULL" ? "全量导入" : "Delta 导入"}</strong><span className="text-xs text-muted-foreground">{value === "FULL" ? "读取“主材库”工作表" : "读取“Delta导入模板”"}</span></button>)}</div><form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={validate}><Label className="sm:col-span-2" htmlFor="main-material-file">Excel 文件</Label><Input accept=".xlsx" id="main-material-file" name="file" required type="file" /><Button disabled={working}><Upload />{working ? "正在校验…" : "上传并校验"}</Button></form>{message ? <p aria-live="polite" className="type-support m-0 rounded-md bg-primary-soft px-3 py-2 text-primary">{message}</p> : null}</CardContent></Card>
    <Card className="h-fit py-0 shadow-none"><CardContent className="p-5"><p className="eyebrow">校验口径</p><h2 className="type-section-title">版本与数据规则</h2><ul className="mt-3 grid gap-2 pl-5 text-sm text-muted-foreground"><li>ACTIVE 商品须有单位、销售价与成本价</li><li>瓷砖还须有品牌与规格，待补资料不可选</li><li>Delta 按 material_id 与 record_version 校验</li><li>发布生成不可变版本，不回写历史报价</li></ul></CardContent></Card>
    {batch ? <section className="grid gap-3 lg:col-span-2"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Metric label="导入记录" value={batch.validation.itemCount} /><Metric label="待补资料" value={batch.validation.pendingItemCount} /><Metric label="警告" value={batch.validation.warningCount} /><Metric label="当前版本" value={currentVersionNumber ?? 0} /><Metric label="当前记录" value={currentItemCount} /></div><Card className="py-0 shadow-none"><CardContent className="grid gap-3 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">02 · 校验与发布</p><h2 className="type-section-title">{batch.validation.blockerCount ? "存在阻断项" : "校验通过"}</h2></div><Badge variant={batch.validation.blockerCount ? "destructive" : "success"}>{batch.validation.blockerCount ? `${batch.validation.blockerCount} 项阻断` : "可发布"}</Badge></div>{batch.validation.blockers.length ? <ul className="validation-errors">{batch.validation.blockers.map((item) => <li key={item}>{item}</li>)}</ul> : null}{batch.validation.warnings.length ? <p className="type-support m-0 rounded-md bg-warning-soft px-3 py-2 text-warning">{batch.validation.warnings.slice(0, 5).join("；")}{batch.validation.warnings.length > 5 ? `；另有 ${batch.validation.warnings.length - 5} 条` : ""}</p> : null}{batch.status === "VALIDATED" ? <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between"><label className="flex items-start gap-2"><Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} /><span className="type-support">我已复核本批次，将其发布为新的不可变主材库版本。</span></label><Button disabled={!confirmed || working} onClick={publish} type="button"><FileCheck2 />{working ? "正在发布…" : "确认发布"}</Button></div> : null}</CardContent></Card></section> : null}
  </div>;
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) { return <Card className="py-0 shadow-none"><CardContent className="grid gap-1 p-4"><span className="type-support text-muted-foreground">{label}</span><strong className="text-2xl">{value}</strong></CardContent></Card>; }
