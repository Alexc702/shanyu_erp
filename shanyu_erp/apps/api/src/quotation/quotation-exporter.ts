import fontkit from "@pdf-lib/fontkit";
import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type {
  QuotationDraft,
  QuotationExportFormat,
} from "./quotation.repository";

export interface GeneratedQuotationExport {
  readonly contentType: string;
  readonly fileName: string;
  readonly payload: Buffer;
}

@Injectable()
export class QuotationExporter {
  async generate(
    quotation: QuotationDraft,
    format: QuotationExportFormat,
  ): Promise<GeneratedQuotationExport> {
    return format === "XLSX"
      ? this.generateWorkbook(quotation)
      : this.generatePdf(quotation);
  }

  private async generateWorkbook(
    quotation: QuotationDraft,
  ): Promise<GeneratedQuotationExport> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "山屿 ERP";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("半包报价单", {
      pageSetup: { fitToPage: true, orientation: "landscape" },
    });
    sheet.columns = [
      { key: "scope", width: 18 },
      { key: "item", width: 38 },
      { key: "unit", width: 10 },
      { key: "quantity", width: 14 },
      { key: "price", width: 14 },
      { key: "amount", width: 14 },
      { key: "remarks", width: 52 },
    ];
    sheet.addRow([`${quotation.projectName} · 半包报价 V${quotation.versionNumber}`]);
    sheet.mergeCells("A1:G1");
    sheet.addRow(["本报价仅包含已选且已计价工程项；金额显示保留 2 位小数。"]);
    sheet.mergeCells("A2:G2");
    sheet.addRow([]);
    sheet.addRow(["分区/空间", "工程项", "单位", "数量", "销售单价", "金额", "施工说明"]);
    const header = sheet.getRow(4);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      pattern: "solid",
      type: "pattern",
      fgColor: { argb: "FF2563EB" },
    };
    for (const row of customerRows(quotation)) {
      sheet.addRow({
        amount: number2(row.amount),
        item: row.itemName,
        price: number2(row.saleUnitPrice),
        quantity: number4(row.quantity),
        remarks: row.remarks ?? "",
        scope: row.scopeName,
        unit: row.unit,
      });
    }
    sheet.addRow([]);
    const totalRow = sheet.addRow({
      amount: number2(quotation.total),
      item: "报价合计（含管理费）",
    });
    totalRow.font = { bold: true };
    sheet.getColumn("price").numFmt = '¥#,##0.00';
    sheet.getColumn("amount").numFmt = '¥#,##0.00';
    sheet.getColumn("quantity").numFmt = "0.0000";
    sheet.views = [{ state: "frozen", ySplit: 4 }];
    const payload = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: `${safeName(quotation.projectName)}-半包报价-V${quotation.versionNumber}.xlsx`,
      payload,
    };
  }

  private async generatePdf(
    quotation: QuotationDraft,
  ): Promise<GeneratedQuotationExport> {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const require = createRequire(__filename);
    const fontPath = require.resolve(
      "@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff",
    );
    const font = await document.embedFont(await readFile(fontPath), {
      subset: true,
    });
    const rows = customerRows(quotation);
    let page = addPdfPage(document, font, quotation, true);
    let y = 735;
    for (const row of rows) {
      const rowHeight = row.remarks ? 35 : 24;
      if (y - rowHeight < 58) {
        page = addPdfPage(document, font, quotation, false);
        y = 758;
      }
      drawRow(page, font, y, row, rowHeight);
      y -= rowHeight;
    }
    if (y < 90) {
      page = addPdfPage(document, font, quotation, false);
      y = 758;
    }
    page.drawText(`报价合计（含管理费）：¥ ${money2(quotation.total)}`, {
      color: rgb(0.09, 0.09, 0.11),
      font,
      size: 13,
      x: 330,
      y: y - 8,
    });
    const payload = Buffer.from(await document.save());
    return {
      contentType: "application/pdf",
      fileName: `${safeName(quotation.projectName)}-半包报价-V${quotation.versionNumber}.pdf`,
      payload,
    };
  }
}

interface CustomerRow {
  readonly amount: string;
  readonly itemName: string;
  readonly quantity: string;
  readonly remarks: string | null;
  readonly saleUnitPrice: string;
  readonly scopeName: string;
  readonly unit: string;
}

function customerRows(quotation: QuotationDraft): CustomerRow[] {
  return quotation.scopes.flatMap((scope) =>
    scope.lines.flatMap((line) =>
      line.selected && line.calculatedQuantity && line.amount
        ? [
            {
              amount: line.amount,
              itemName: line.itemName,
              quantity: line.calculatedQuantity,
              remarks: line.remarks,
              saleUnitPrice: line.saleUnitPrice,
              scopeName: scope.name,
              unit: line.unit,
            },
          ]
        : [],
    ),
  );
}

function addPdfPage(
  document: PDFDocument,
  font: PDFFont,
  quotation: QuotationDraft,
  cover: boolean,
): PDFPage {
  const page = document.addPage([595.28, 841.89]);
  page.drawText(
    cover
      ? `${quotation.projectName} · 半包报价单`
      : `${quotation.projectName} · 半包报价 V${quotation.versionNumber}`,
    { color: rgb(0.09, 0.09, 0.11), font, size: cover ? 20 : 12, x: 36, y: 800 },
  );
  if (cover) {
    page.drawText(`版本：V${quotation.versionNumber}（已审批）`, {
      color: rgb(0.45, 0.45, 0.5), font, size: 10, x: 36, y: 778,
    });
    page.drawText("仅列出已选且已计价工程项，金额保留 2 位小数。", {
      color: rgb(0.45, 0.45, 0.5), font, size: 9, x: 36, y: 760,
    });
  }
  return page;
}

function drawRow(
  page: PDFPage,
  font: PDFFont,
  y: number,
  row: CustomerRow,
  height: number,
): void {
  const color = rgb(0.16, 0.16, 0.18);
  page.drawText(ellipsis(row.scopeName, 10), { color, font, size: 8, x: 36, y });
  page.drawText(ellipsis(row.itemName, 26), { color, font, size: 8, x: 112, y });
  page.drawText(row.unit, { color, font, size: 8, x: 342, y });
  page.drawText(number4(row.quantity).toFixed(4), { color, font, size: 8, x: 380, y });
  page.drawText(`¥${money2(row.saleUnitPrice)}`, { color, font, size: 8, x: 454, y });
  page.drawText(`¥${money2(row.amount)}`, { color, font, size: 8, x: 516, y });
  if (row.remarks) {
    page.drawText(`施工说明：${ellipsis(row.remarks.replaceAll("\n", " "), 78)}`, {
      color: rgb(0.42, 0.42, 0.46),
      font,
      size: 6.5,
      x: 112,
      y: y - 12,
    });
  }
  page.drawLine({
    color: rgb(0.9, 0.9, 0.92),
    end: { x: 560, y: y - height + 8 },
    start: { x: 36, y: y - height + 8 },
    thickness: 0.5,
  });
}

function number2(value: string): number {
  return Number.parseFloat(money2(value));
}

function number4(value: string): number {
  return Number.parseFloat(Number.parseFloat(value).toFixed(4));
}

function money2(value: string): string {
  return Number.parseFloat(value).toFixed(2);
}

function ellipsis(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-");
}
