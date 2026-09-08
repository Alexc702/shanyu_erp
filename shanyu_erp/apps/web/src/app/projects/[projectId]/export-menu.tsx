"use client";

import type { HalfPackageExportAudience, HalfPackageExportFormat } from "@shanyu/contracts";
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
  readonly allowInternal?: boolean;
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly fileNameStem: string;
  readonly fullWidth?: boolean;
  readonly quotationId: string;
}

export function ExportMenu({
  allowInternal = false,
  compact = false,
  disabled = false,
  fileNameStem,
  fullWidth = false,
  quotationId,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<HalfPackageExportAudience>("CLIENT");
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
        const record = await createQuotationExport(quotationId, format, audience);
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
            导出绑定当前可导出的报价版本；折扣和抹零审批通过后才会进入客户文件。
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

        {allowInternal ? (
          <section className="grid gap-2">
            <h3 className="type-table-head m-0">文件用途</h3>
            <div className="flex gap-2.5">
              <AudienceOption audience="CLIENT" current={audience} label="客户版" onSelect={(value) => { setAudience(value); setFormats(["PDF", "XLSX"]); }} />
              <AudienceOption audience="INTERNAL" current={audience} label="内部成本版" onSelect={(value) => { setAudience(value); setFormats(["XLSX"]); }} />
            </div>
          </section>
        ) : null}

        <section className="grid gap-2.5 rounded-lg bg-muted p-3.5">
          <h3 className="type-table-head m-0 font-semibold">导出规则</h3>
          <p className="type-table-body m-0">
            ✓ 半包与主材分 Sheet　 ✓ 还原标准模板　 ✓ 自动生成分类小计
          </p>
          <p className="type-support m-0 text-muted-foreground">
            仅导出数量大于 0 的内容；{audience === "CLIENT" ? "客户版物理移除成本字段" : "内部版标记并包含主材成本列"}
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

function AudienceOption({ audience, current, label, onSelect }: { readonly audience: HalfPackageExportAudience; readonly current: HalfPackageExportAudience; readonly label: string; readonly onSelect: (value: HalfPackageExportAudience) => void }) {
  const selected = audience === current;
  return <button aria-pressed={selected} className={cn("type-table-head flex h-[46px] min-w-[150px] items-center gap-2 rounded-lg border px-3.5", selected ? "border-primary bg-primary-soft" : "border-border bg-background text-muted-foreground")} onClick={() => onSelect(audience)} type="button">{selected ? <Check className="size-4 text-primary" /> : null}{label}</button>;
}
