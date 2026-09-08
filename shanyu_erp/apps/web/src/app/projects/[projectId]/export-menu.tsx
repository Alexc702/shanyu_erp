"use client";

import type { HalfPackageExportFormat } from "@shanyu/contracts";
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
import { apiUrl } from "@/lib/api-url";
import { createQuotationExport } from "@/lib/quotation-client";
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
  const [formats, setFormats] = useState<HalfPackageExportFormat[]>([
    "PDF",
    "XLSX",
  ]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleFormat(format: HalfPackageExportFormat): void {
    setFormats((current) =>
      current.includes(format)
        ? current.filter((candidate) => candidate !== format)
        : [...current, format],
    );
  }

  async function exportFiles(): Promise<void> {
    if (working || formats.length === 0) return;
    setWorking(true);
    setError(null);
    try {
      for (const format of formats) {
        const record = await createQuotationExport(quotationId, format);
        const link = document.createElement("a");
        link.href = `${apiUrl}${record.downloadPath}`;
        link.download = record.fileName;
        document.body.append(link);
        link.click();
        link.remove();
      }
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setWorking(false);
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
          <DialogTitle className="text-xl font-semibold">导出半包报价单</DialogTitle>
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
            仅导出上一个确认/审批完的版本，最新的折扣和抹零经过审批生效后支持导出。
          </span>
        </div>

        <section className="grid gap-2">
          <h3 className="type-table-head m-0">文件格式</h3>
          <div className="flex gap-2.5">
            <FormatOption
              format="PDF"
              icon={<FileText className="size-4" />}
              selected={formats.includes("PDF")}
              toggle={toggleFormat}
            />
            <FormatOption
              format="XLSX"
              icon={<FileSpreadsheet className="size-4" />}
              selected={formats.includes("XLSX")}
              toggle={toggleFormat}
            />
          </div>
        </section>

        <section className="grid gap-2.5 rounded-lg bg-muted p-3.5">
          <h3 className="type-table-head m-0 font-semibold">导出规则</h3>
          <p className="type-table-body m-0">
            ✓ 1:1 还原标准模板　 ✓ 自动添加空间序号　 ✓ 管理费归入【十三、工程汇总】
          </p>
          <p className="type-support m-0 text-muted-foreground">
            仅导出数量大于 0 的工程项；PDF 沿用 Excel 的打印区域设置
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

        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={working} type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            disabled={working || formats.length === 0}
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
  selected,
  toggle,
}: {
  readonly format: HalfPackageExportFormat;
  readonly icon: React.ReactNode;
  readonly selected: boolean;
  readonly toggle: (format: HalfPackageExportFormat) => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "type-table-head flex h-[52px] w-[150px] items-center gap-2 rounded-lg border px-3.5 text-left transition-colors",
        selected
          ? "border-primary bg-primary-soft text-foreground"
          : "border-border bg-background text-muted-foreground",
      )}
      onClick={() => toggle(format)}
      type="button"
    >
      {selected ? <Check className="size-4 text-primary" /> : icon}
      {format}
    </button>
  );
}
