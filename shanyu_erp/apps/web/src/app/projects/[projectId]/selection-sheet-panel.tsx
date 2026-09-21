"use client";

import type { HalfPackageExportRecord } from "@shanyu/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createSelectionSheetExport, latestSelectionSheetExport, waitForQuotationExport, fetchQuotationExportFile } from "@/lib/quotation-client";
import { SelectionPdfPreview } from "./selection-pdf-preview";

export function SelectionSheetPanel({ quotationId }: { readonly quotationId: string }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; record: HalfPackageExportRecord } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true, objectUrl: string | null = null;
      void latestSelectionSheetExport(quotationId).then(async job => {
        if (!active || !job) return null;
        setBusy(job.status === "PENDING" || job.status === "RUNNING");
        setMessage(job.status === "SUCCEEDED" ? "已恢复该报价版本的选材单，可下载原文件。" : job.status === "FAILED" ? "生成失败，可重试原版本。" : "正在恢复该报价版本的导出任务…");
        return waitForQuotationExport(job);
      }).then(async record => {
        if (!record || !active) return;
        const blob = await fetchQuotationExportFile(record);
        if (!active) return;
        objectUrl = URL.createObjectURL(blob); setPreview({ url: objectUrl, record });
      }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : "恢复任务失败"); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [quotationId]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  async function generate() {
    if (busy) return;
    setBusy(true); setMessage("已排队，关闭弹窗不会取消任务；再次打开可恢复进度。");
    try {
      const job = await createSelectionSheetExport(quotationId, accepted);
      const record = await waitForQuotationExport(job);
      const blob = await fetchQuotationExportFile(record);
      if (!alive.current) return;
      setPreview({ url: URL.createObjectURL(blob), record }); setMessage("已生成。预览与下载使用同一 PDF 文件。");
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : "生成失败，请重试"); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="grid gap-3">
    <div className="rounded-lg bg-muted p-3 type-support">仅 PDF；只包含当前报价版本已完成颜色选型的主材，不含价格、成本和采购数量。</div>
    <label className="flex items-start gap-2 type-support"><Checkbox checked={accepted} onCheckedChange={value => setAccepted(value === true)} />图片尚未完成对客审核。我已知悉本次使用“产品图待补充”占位，确认按当前资料生成。</label>
    {message ? <p role="status" className="type-support">{message}</p> : null}
    {preview ? <><SelectionPdfPreview key={preview.url} url={preview.url} /><Button asChild><a href={preview.url} download={preview.record.fileName}>下载选材单 PDF</a></Button></> : null}
    <Button disabled={busy || !accepted} onClick={() => void generate()}>{busy ? "生成中…" : preview ? "重新生成" : "生成并预览选材单"}</Button>
  </section>;
}
