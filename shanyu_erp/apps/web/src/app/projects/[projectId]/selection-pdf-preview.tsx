"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@/components/ui/button";

/** Renders the downloaded, authenticated PDF itself; no second document template. */
export function SelectionPdfPreview({ url }: { readonly url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState("");
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void import("pdfjs-dist/build/pdf.min.mjs").then(async pdfjs => {
      if (!active) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const task = pdfjs.getDocument({ url, isEvalSupported: false });
      dispose = () => { void task.destroy(); };
      const loaded = await task.promise;
      if (active) setDocument(loaded);
    }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : "PDF 加载失败"); });
    return () => { active = false; dispose?.(); };
  }, [url]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true;
    let task: RenderTask | undefined;
    const target = canvas.current;
    void document.getPage(page).then(async pdfPage => {
      if (!active) return;
      const viewport = pdfPage.getViewport({ scale: zoom });
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      task = pdfPage.render({ canvas: target, viewport });
      await task.promise;
      if (active) setRendered(`${page}:${zoom}`);
    }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : "PDF 预览失败"); });
    return () => { active = false; task?.cancel(); };
  }, [document, page, zoom]);
  return <section className="grid gap-2" aria-label="项目选材单 PDF 预览">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={!document || page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span className="type-support">第 {page} / {document?.numPages ?? "—"} 页</span><Button variant="outline" size="sm" disabled={!document || page === document.numPages} onClick={() => setPage(value => value + 1)}>下一页</Button></div>
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={zoom <= 0.5} onClick={() => setZoom(value => value - 0.25)}>缩小</Button><span className="type-support">{Math.round(zoom * 100)}%</span><Button variant="outline" size="sm" disabled={zoom >= 2} onClick={() => setZoom(value => value + 0.25)}>放大</Button></div>
    </div>
    {error ? <p role="alert" className="type-support text-destructive">{error}，可下载原 PDF 查看。</p> : null}
    <div className="h-[55vh] overflow-auto rounded border bg-muted p-3" aria-busy={rendered !== `${page}:${zoom}`}><canvas ref={canvas} className="mx-auto bg-white shadow-sm" aria-label={`选材单第 ${page} 页`} data-rendered={rendered} /></div>
  </section>;
}
