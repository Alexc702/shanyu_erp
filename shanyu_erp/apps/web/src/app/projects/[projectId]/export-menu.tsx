"use client";

import type { HalfPackageExportFormat } from "@shanyu/contracts";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiUrl } from "@/lib/api-url";
import { createQuotationExport } from "@/lib/quotation-client";

export function ExportMenu({ quotationId }: { readonly quotationId: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportFile(format: HalfPackageExportFormat): Promise<void> {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const record = await createQuotationExport(quotationId, format);
      const link = document.createElement("a");
      link.href = `${apiUrl}${record.downloadPath}`;
      link.download = record.fileName;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button>
          <Printer />
          打印/导出
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-52 gap-2 p-2">
        <p className="type-table-head px-2 pt-1">客户版报价文件</p>
        <Button
          className="w-full justify-start"
          disabled={working}
          onClick={() => exportFile("PDF")}
          type="button"
          variant="ghost"
        >
          <FileText />
          导出 PDF
        </Button>
        <Button
          className="w-full justify-start"
          disabled={working}
          onClick={() => exportFile("XLSX")}
          type="button"
          variant="ghost"
        >
          <FileSpreadsheet />
          导出 Excel
        </Button>
        {error ? (
          <p
            className="type-support m-0 rounded-md bg-destructive-soft px-2 py-1.5 text-destructive"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <p className="type-support flex items-center gap-1.5 border-t border-border px-2 pt-2 text-muted-foreground">
          <Download className="size-3" />
          文件仅包含客户报价内容
        </p>
      </PopoverContent>
    </Popover>
  );
}
