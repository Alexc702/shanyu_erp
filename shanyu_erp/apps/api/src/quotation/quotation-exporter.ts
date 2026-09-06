import fontkit from "@pdf-lib/fontkit";
import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
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

interface ExportContext {
  readonly customerName: string;
  readonly quotation: QuotationDraft;
  readonly sections: readonly ExportSection[];
}

interface ExportLine {
  readonly amount: string;
  readonly itemName: string;
  readonly quantity: string;
  readonly remarks: string | null;
  readonly saleUnitPrice: string;
  readonly unit: string;
}

interface ExportSection {
  readonly area: string | null;
  readonly height: string | null;
  readonly lines: readonly ExportLine[];
  readonly name: string;
  readonly perimeter: string | null;
  readonly subtotal: string;
}

const templateFileName = "半包报价单excel导出模版_v1.xlsx";

@Injectable()
export class QuotationExporter {
  async generate(
    quotation: QuotationDraft,
    format: QuotationExportFormat,
    customerName = "",
  ): Promise<GeneratedQuotationExport> {
    const context = {
      customerName,
      quotation,
      sections: exportSections(quotation),
    } satisfies ExportContext;
    return format === "XLSX"
      ? this.generateWorkbook(context)
      : this.generatePdf(context);
  }

  private async generateWorkbook(
    context: ExportContext,
  ): Promise<GeneratedQuotationExport> {
    const template = new ExcelJS.Workbook();
    await template.xlsx.load((await readTemplate()) as never);
    const source = template.getWorksheet("半包报价模板") ?? template.worksheets[0];
    if (!source) throw new Error("半包报价导出模板缺少工作表");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "山屿 ERP";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("半包报价模板", {
      pageSetup: { ...source.pageSetup },
      properties: { ...source.properties },
      views: source.views.map((view) => ({ ...view })),
    });
    for (let column = 1; column <= 9; column += 1) {
      sheet.getColumn(column).width = source.getColumn(column).width;
      sheet.getColumn(column).hidden = source.getColumn(column).hidden;
    }
    copyTemplateImage(template, source, workbook, sheet);

    for (let rowNumber = 1; rowNumber <= 4; rowNumber += 1) {
      copyStyledRow(source.getRow(rowNumber), sheet.getRow(rowNumber));
    }
    sheet.mergeCells("A1:I1");
    sheet.mergeCells("A2:B2");
    sheet.mergeCells("C2:D2");
    sheet.mergeCells("E2:F2");
    sheet.mergeCells("A3:B4");
    sheet.mergeCells("C3:D4");
    sheet.mergeCells("E3:E4");
    sheet.mergeCells("F3:F4");
    sheet.mergeCells("G3:H3");
    sheet.mergeCells("I3:I4");
    applyMergedOutline(sheet, 3, 1, 4, 2, { left: "medium" });
    applyMergedOutline(sheet, 3, 3, 4, 4);
    applyMergedOutline(sheet, 3, 5, 4, 5);
    applyMergedOutline(sheet, 3, 6, 4, 6);
    applyMergedOutline(sheet, 3, 7, 3, 8);
    applyMergedOutline(sheet, 3, 9, 4, 9, { right: "medium" });
    applyMergedOutline(sheet, 4, 7, 4, 7);
    applyMergedOutline(sheet, 4, 8, 4, 8);
    sheet.getCell("A1").value = "基础报价明细表";
    sheet.getCell("A2").value = "客户名称：";
    sheet.getCell("C2").value = context.customerName;
    sheet.getCell("E2").value = "外框面积（㎡）：";
    sheet.getCell("G2").value = number2(context.quotation.outerFrameArea);
    sheet.getCell("H2").value = "工程地址：";
    sheet.getCell("I2").value = context.quotation.projectAddress;

    const itemRows = templateItemRows(source);
    let outputRow = 5;
    context.sections.forEach((section, sectionIndex) => {
      const heading = sheet.getRow(outputRow);
      copyStyledRow(source.getRow(26), heading);
      sheet.mergeCells(outputRow, 1, outputRow, 3);
      heading.getCell(1).value = sectionHeading(sectionIndex + 1, section.name);
      heading.getCell(4).value = section.area ? "面积（㎡)：" : null;
      heading.getCell(5).value = section.area ? number2(section.area) : null;
      heading.getCell(6).value = section.perimeter ? "周长（m):" : null;
      heading.getCell(7).value = section.perimeter
        ? number2(section.perimeter)
        : null;
      heading.getCell(8).value = section.height ? "层高（m):" : null;
      heading.getCell(9).value = section.height ? number2(section.height) : null;
      outputRow += 1;

      section.lines.forEach((line, lineIndex) => {
        const sourceRow = itemRows.get(line.itemName) ?? source.getRow(27);
        const target = sheet.getRow(outputRow);
        copyStyledRow(sourceRow, target);
        sheet.mergeCells(outputRow, 1, outputRow, 2);
        sheet.mergeCells(outputRow, 3, outputRow, 4);
        applyMergedOutline(sheet, outputRow, 1, outputRow, 2, {
          left: "medium",
        });
        applyMergedOutline(sheet, outputRow, 3, outputRow, 4);
        target.getCell(1).value = lineIndex + 1;
        target.getCell(3).value = line.itemName;
        target.getCell(5).value = formatExportUnit(line.unit);
        target.getCell(6).value = number4(line.quantity);
        target.getCell(7).value = number2(line.saleUnitPrice);
        target.getCell(8).value = number2(line.amount);
        target.getCell(9).value = line.remarks ?? "";
        target.getCell(9).alignment = {
          ...target.getCell(9).alignment,
          vertical: "middle",
          wrapText: true,
        };
        target.height = excelItemRowHeight(line.itemName, line.remarks);
        outputRow += 1;
      });

      const subtotal = sheet.getRow(outputRow);
      copyStyledRow(source.getRow(25), subtotal);
      sheet.mergeCells(outputRow, 1, outputRow, 7);
      subtotal.getCell(1).value = "小计：";
      subtotal.getCell(8).value = number2(section.subtotal);
      subtotal.getCell(9).value = null;
      outputRow += 1;
    });

    const summaryHeading = sheet.getRow(outputRow);
    copyStyledRow(source.getRow(200), summaryHeading);
    sheet.mergeCells(outputRow, 1, outputRow, 3);
    summaryHeading.getCell(1).value = "【十三、工程汇总】";
    outputRow += 1;

    const discountSavings = Math.max(
      0,
      Number(context.quotation.total) - Number(context.quotation.adjustedTotal),
    );
    const summaryRows = [
      ["（1）", "直接费", number2(context.quotation.directCost), ""],
      ["（2）", "管理费", number2(context.quotation.managementFee), "管理费统一按半包直接费 10% 计算。"],
      ["（3）", "折扣/抹零", -number2(discountSavings.toFixed(4)), "按已确认折扣与抹零计算。"],
      ["（4）", "总造价", number2(context.quotation.adjustedTotal), ""],
    ] as const;
    summaryRows.forEach(([number, label, amount, remarks], index) => {
      const target = sheet.getRow(outputRow);
      copyStyledRow(source.getRow(201 + index), target);
      target.getCell(2).value = number;
      target.getCell(3).value = label;
      target.getCell(5).value = "元";
      target.getCell(7).value = amount;
      target.getCell(8).value = null;
      target.getCell(9).value = remarks;
      outputRow += 1;
    });

    sheet.pageSetup.printArea = `A1:I${outputRow - 1}`;
    sheet.pageSetup.fitToWidth = 1;
    sheet.pageSetup.fitToHeight = 1;
    const payload = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: exportFileName(context.quotation, "xlsx"),
      payload,
    };
  }

  private async generatePdf(
    context: ExportContext,
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
    const rows = pdfRows(context);
    let page = addLandscapePage(document);
    let y = 575;
    for (const row of rows) {
      if (y - row.height < 18) {
        page = addLandscapePage(document);
        y = 575;
      }
      drawPdfRow(page, font, y, row);
      y -= row.height;
    }
    const payload = Buffer.from(await document.save());
    return {
      contentType: "application/pdf",
      fileName: exportFileName(context.quotation, "pdf"),
      payload,
    };
  }
}

async function readTemplate(): Promise<Buffer> {
  const candidates = [
    join(process.cwd(), "assets", templateFileName),
    join(process.cwd(), "apps", "api", "assets", templateFileName),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`找不到半包报价导出模板：${templateFileName}`);
}

function copyTemplateImage(
  sourceWorkbook: ExcelJS.Workbook,
  sourceSheet: ExcelJS.Worksheet,
  targetWorkbook: ExcelJS.Workbook,
  targetSheet: ExcelJS.Worksheet,
): void {
  for (const placement of sourceSheet.getImages()) {
    const image = sourceWorkbook.getImage(Number(placement.imageId));
    if (!image?.buffer || !image.extension) continue;
    const imageId = targetWorkbook.addImage({
      buffer: image.buffer,
      extension: image.extension,
    });
    targetSheet.addImage(imageId, placement.range);
  }
}

function copyStyledRow(source: ExcelJS.Row, target: ExcelJS.Row): void {
  target.height = source.height;
  for (let column = 1; column <= 9; column += 1) {
    const sourceCell = source.getCell(column);
    const targetCell = target.getCell(column);
    targetCell.style = structuredClone(sourceCell.style);
    targetCell.value = sourceCell.value;
  }
}

function applyMergedOutline(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
  emphasis: {
    readonly left?: ExcelJS.BorderStyle;
    readonly right?: ExcelJS.BorderStyle;
  } = {},
): void {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.border = {
        ...cell.border,
        ...(row === startRow ? { top: { style: "thin" } } : {}),
        ...(row === endRow ? { bottom: { style: "thin" } } : {}),
        ...(column === startColumn
          ? { left: { style: emphasis.left ?? "thin" } }
          : {}),
        ...(column === endColumn
          ? { right: { style: emphasis.right ?? "thin" } }
          : {}),
      };
    }
  }
}

function excelItemRowHeight(itemName: string, remarks: string | null): number {
  const itemLines = estimatedLineCount(itemName, 34);
  const remarkLines = estimatedLineCount(remarks ?? "", 34);
  return Math.max(25, Math.max(itemLines, remarkLines) * 15 + 1);
}

function templateItemRows(sheet: ExcelJS.Worksheet): Map<string, ExcelJS.Row> {
  const rows = new Map<string, ExcelJS.Row>();
  for (let rowNumber = 5; rowNumber <= 199; rowNumber += 1) {
    const name = sheet.getRow(rowNumber).getCell(3).text.trim();
    if (name && !name.startsWith("【") && name !== "小计：") {
      rows.set(name, sheet.getRow(rowNumber));
    }
  }
  return rows;
}

function exportSections(quotation: QuotationDraft): ExportSection[] {
  return quotation.scopes.flatMap((scope) => {
    const lines = scope.lines.flatMap((line) => {
      const quantity = Number(line.calculatedQuantity ?? 0);
      return line.selected && quantity > 0 && line.amount
        ? [{
            amount: line.amount,
            itemName: line.itemName,
            quantity: line.calculatedQuantity ?? "0.0000",
            remarks: line.remarks,
            saleUnitPrice: line.saleUnitPrice,
            unit: line.unit,
          }]
        : [];
    });
    return lines.length
      ? [{
          area: scope.area,
          height: scope.height,
          lines,
          name: scope.name,
          perimeter: scope.perimeter,
          subtotal: lines
            .reduce((total, line) => total + Number(line.amount), 0)
            .toFixed(4),
        }]
      : [];
  });
}

function sectionHeading(index: number, name: string): string {
  const clean = name.replace(/^[一二三四五六七八九十]+、/, "");
  const label = clean.endsWith("工程") ? clean : `${clean}工程`;
  return `【${chineseNumber(index)}、${label}】`;
}

function chineseNumber(value: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 10) return digits[value] ?? String(value);
  if (value === 10) return "十";
  if (value < 20) return `十${digits[value - 10] ?? ""}`;
  return `${digits[Math.floor(value / 10)] ?? ""}十${digits[value % 10] ?? ""}`;
}

interface PdfRow {
  readonly background: "blue" | "grey" | "none" | "summary";
  readonly bold: boolean;
  readonly cells: readonly string[];
  readonly height: number;
  readonly kind: "full" | "table";
  readonly size: number;
}

function pdfRows(context: ExportContext): PdfRow[] {
  const rows: PdfRow[] = [
    { background: "none", bold: true, cells: ["基础报价明细表"], height: 34, kind: "full", size: 18 },
    { background: "blue", bold: true, cells: [`客户名称：${context.customerName}    外框面积（㎡）：${number2(context.quotation.outerFrameArea).toFixed(2)}    工程地址：${context.quotation.projectAddress}`], height: 28, kind: "full", size: 11 },
    { background: "blue", bold: true, cells: ["编号", "工程项目", "单位", "数量", "单价", "金额", "备注"], height: 30, kind: "table", size: 11 },
  ];
  context.sections.forEach((section, sectionIndex) => {
    rows.push({ background: "blue", bold: true, cells: [sectionHeading(sectionIndex + 1, section.name)], height: 26, kind: "full", size: 11 });
    section.lines.forEach((line, lineIndex) => {
      rows.push({
        background: "none",
        bold: false,
        cells: [String(lineIndex + 1), line.itemName, formatExportUnit(line.unit), number4(line.quantity).toFixed(2), number2(line.saleUnitPrice).toFixed(2), number2(line.amount).toFixed(2), line.remarks ?? ""],
        height: pdfItemRowHeight(line.itemName, line.remarks),
        kind: "table",
        size: 10,
      });
    });
    rows.push({ background: "none", bold: true, cells: ["", "小计", "元", "", "", number2(section.subtotal).toFixed(2), ""], height: 26, kind: "table", size: 10 });
  });
  rows.push({ background: "blue", bold: true, cells: ["【十三、工程汇总】"], height: 22, kind: "full", size: 9 });
  const savings = Math.max(0, Number(context.quotation.total) - Number(context.quotation.adjustedTotal));
  [
    ["（1）", "直接费", context.quotation.directCost, ""],
    ["（2）", "管理费", context.quotation.managementFee, "管理费统一按半包直接费 10% 计算。"],
    ["（3）", "折扣/抹零", (-savings).toFixed(4), "按已确认折扣与抹零计算。"],
    ["（4）", "总造价", context.quotation.adjustedTotal, ""],
  ].forEach(([number, label, amount, remarks]) => rows.push({ background: "summary", bold: true, cells: [number ?? "", label ?? "", "元", "", "", number2(amount ?? "0").toFixed(2), remarks ?? ""], height: 22, kind: "table", size: 8 }));
  return rows;
}

function addLandscapePage(document: PDFDocument): PDFPage {
  return document.addPage([841.89, 595.28]);
}

function drawPdfRow(page: PDFPage, font: PDFFont, top: number, row: PdfRow): void {
  const x = 18;
  const width = 805;
  const bottom = top - row.height;
  const background = row.background === "blue"
    ? rgb(0.78, 0.86, 0.96)
    : row.background === "grey"
      ? rgb(0.94, 0.94, 0.94)
      : row.background === "summary"
        ? rgb(0.88, 0.91, 0.95)
        : rgb(1, 1, 1);
  page.drawRectangle({ x, y: bottom, width, height: row.height, color: background, borderColor: rgb(0.25, 0.25, 0.25), borderWidth: 0.45 });
  if (row.kind === "full") {
    const text = row.cells[0] ?? "";
    const textWidth = font.widthOfTextAtSize(text, row.size);
    page.drawText(text, { font, size: row.size, x: row.size >= 18 ? x + (width - textWidth) / 2 : x + 8, y: bottom + (row.height - row.size) / 2 });
    return;
  }
  const widths = [42, 190, 40, 58, 64, 72, 339];
  let cellX = x;
  row.cells.forEach((text, index) => {
    const cellWidth = widths[index] ?? 0;
    if (index > 0) page.drawLine({ start: { x: cellX, y: bottom }, end: { x: cellX, y: top }, color: rgb(0.45, 0.45, 0.45), thickness: 0.35 });
    const lines = wrapText(text, font, row.size, cellWidth - 8, Math.max(1, Math.floor((row.height - 7) / (row.size + 2))));
    lines.forEach((line, lineIndex) => page.drawText(line, { font, size: row.size, x: cellX + 4, y: top - row.size - 5 - lineIndex * (row.size + 2) }));
    cellX += cellWidth;
  });
}

function wrapText(text: string, font: PDFFont, size: number, width: number, maxLines: number): string[] {
  const normalized = text.trim();
  if (!normalized) return [""];
  const lines: string[] = [];
  for (const paragraph of normalized.split(/\r?\n/)) {
    let current = "";
    for (const character of paragraph) {
      const candidate = current + character;
      if (current && font.widthOfTextAtSize(candidate, size) > width) {
        lines.push(current);
        current = character;
        if (lines.length === maxLines) break;
      } else {
        current = candidate;
      }
    }
    if (lines.length === maxLines) break;
    lines.push(current);
    if (lines.length === maxLines) break;
  }
  if (
    lines.length === maxLines &&
    normalized.replaceAll("\n", "").length > lines.join("").length
  ) {
    lines[maxLines - 1] = `${(lines[maxLines - 1] ?? "").slice(0, -1)}…`;
  }
  return lines;
}

function pdfItemRowHeight(itemName: string, remarks: string | null): number {
  const itemLines = estimatedLineCount(itemName, 18);
  const remarkLines = estimatedLineCount(remarks ?? "", 32);
  return Math.max(30, 10 + Math.max(itemLines, remarkLines) * 12);
}

function estimatedLineCount(text: string, charactersPerLine: number): number {
  if (!text) return 1;
  return text.split(/\r?\n/).reduce((total, paragraph) => {
    const width = Array.from(paragraph).reduce(
      (sum, character) => sum + (/\p{Script=Han}/u.test(character) ? 1 : 0.55),
      0,
    );
    return total + Math.max(1, Math.ceil(width / charactersPerLine));
  }, 0);
}

function formatExportUnit(unit: string): string {
  return /^m2$/i.test(unit.trim()) ? "M²" : unit;
}

function number2(value: string): number {
  return Number.parseFloat(Number.parseFloat(value).toFixed(2));
}

function number4(value: string): number {
  return Number.parseFloat(Number.parseFloat(value).toFixed(4));
}

function exportFileName(quotation: QuotationDraft, extension: "pdf" | "xlsx"): string {
  return `${safeName(quotation.projectAddress)}_半包报价单_V${quotation.versionNumber}.${extension}`;
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-");
}
