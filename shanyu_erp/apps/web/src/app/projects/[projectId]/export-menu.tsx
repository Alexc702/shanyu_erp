"use client";

import type { HalfPackageExportFormat, HalfPackageExportRecord } from "@shanyu/contracts";
import { Check, FileSpreadsheet, FileText, Info, Printer } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createQuotationExport,
  fetchQuotationExportFile,
  waitForQuotationExport,
} from "@/lib/quotation-client";
import { cn } from "@/lib/utils";

interface ExportMenuProps {
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly fileNameStem: string;
  readonly fullWidth?: boolean;
  readonly quotationId: string;
}

export function ExportMenu({
  compact = false,
  disabled = false,
  fileNameStem,
  fullWidth = false,
  quotationId,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<HalfPackageExportFormat>("PDF");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportFiles(): Promise<void> {
    if (working) return;
    setWorking(true);
    setError(null);
    setProgress("正在加入导出队列…");
    try {
      const job = await createQuotationExport(quotationId, format);
      setProgress("已排队，正在生成…");
      const record = await waitForQuotationExport(job);
      setProgress("已生成，正在下载…");
      await downloadExport(record);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setWorking(false);
      setProgress(null);
    }
  }

  return (
    <Dialog onOpenChange={(nextOpen) => !working && setOpen(nextOpen)} open={open}>
      <DialogTrigger asChild>
        <Button
          className={fullWidth ? "w-full" : undefined}
          disabled={disabled}
          size={compact ? "sm" : "default"}
          variant={compact ? "outline" : "default"}
        >
          <Printer />
          {compact ? "导出" : "打印/导出"}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] max-w-[560px] gap-[18px] rounded-xl p-6">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-xl font-semibold">导出项目报价单</DialogTitle>
          <DialogDescription className="type-table-body">
            Excel 与 PDF 共用标准打印模板。
          </DialogDescription>
        </DialogHeader>

        <div
          className="type-table-body flex items-start gap-2 rounded-lg bg-warning-soft px-3.5 py-3 text-warning"
          role="note"
        >
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            导出绑定当前可导出的报价版本；折扣和抹零审批通过后才会进入导出文件。
          </span>
        </div>

        <section className="grid gap-2">
          <h3 className="type-table-head m-0">文件格式</h3>
          <div aria-label="文件格式" className="flex gap-2.5" role="radiogroup">
            <FormatOption
              format="PDF"
              icon={<FileText className="size-4" />}
              select={setFormat}
              selected={format === "PDF"}
            />
            <FormatOption
              format="XLSX"
              icon={<FileSpreadsheet className="size-4" />}
              select={setFormat}
              selected={format === "XLSX"}
            />
          </div>
        </section>

        <section className="grid gap-2.5 rounded-lg bg-muted p-3.5">
          <h3 className="type-table-head m-0 font-semibold">导出规则</h3>
          <p className="type-table-body m-0">
            ✓ 半包与主材分 Sheet　 ✓ 还原标准模板　 ✓ 自动生成分类小计
          </p>
          <p className="type-support m-0 text-muted-foreground">
            仅导出数量大于 0 的内容；导出文件不包含成本字段
          </p>
          <p className="type-support m-0 text-muted-foreground">
            PDF版本和Excel版本内容一致，PDF版本不可编辑。
          </p>
        </section>

        <section className="grid gap-1.5">
          <label className="type-table-head" htmlFor="quotation-export-file-name">
            文件名
          </label>
          <Input
            id="quotation-export-file-name"
            readOnly
            value={fileNameStem}
          />
        </section>

        {error ? (
          <p
            className="type-support m-0 rounded-md bg-destructive-soft px-3 py-2 text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {working && progress ? (
          <p className="type-support m-0 text-muted-foreground" role="status">
            {progress}，完成后将自动下载。
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={working} type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            disabled={working}
            onClick={exportFiles}
            type="button"
          >
            {working ? "正在导出…" : "开始导出"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormatOption({
  format,
  icon,
  select,
  selected,
}: {
  readonly format: HalfPackageExportFormat;
  readonly icon: React.ReactNode;
  readonly select: (format: HalfPackageExportFormat) => void;
  readonly selected: boolean;
}) {
  return (
    <button
      aria-checked={selected}
      className={cn(
        "type-table-head flex h-[52px] w-[150px] items-center gap-2 rounded-lg border px-3.5 text-left transition-colors",
        selected
          ? "border-primary bg-primary-soft text-foreground"
          : "border-border bg-background text-muted-foreground",
      )}
      onClick={() => select(format)}
      role="radio"
      type="button"
    >
      {selected ? <Check className="size-4 text-primary" /> : icon}
      {format}
    </button>
  );
}

async function downloadExport(record: HalfPackageExportRecord): Promise<void> {
  const blob = await fetchQuotationExportFile(record);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = record.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
