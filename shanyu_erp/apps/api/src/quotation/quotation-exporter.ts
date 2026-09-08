import fontkit from "@pdf-lib/fontkit";
import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  PDFDocument,
  PDFName,
  PDFString,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

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
  readonly summary: QuotationExportSummary;
}

export interface QuotationExportSummaryRow {
  readonly amount: string;
  readonly label: "直接费" | "管理费" | "折扣和抹零" | "税金" | "总造价";
  readonly number: string;
  readonly remarks: string;
}

export interface QuotationExportSummary {
  readonly grandTotal: string;
  readonly rows: readonly QuotationExportSummaryRow[];
  readonly taxableTotal: string;
  readonly taxAmount: string;
  readonly taxRate: "0.0600";
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

const templateFileName = "新报价2026年8月27主材修改.xlsx";
const mainMaterialTemplateFileName = "主材报价模版_v1.xlsx";
let templateWorkbookPromise: Promise<ExcelJS.Workbook> | undefined;
let mainMaterialTemplateWorkbookPromise: Promise<ExcelJS.Workbook> | undefined;

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
      summary: buildQuotationExportSummary(quotation),
    } satisfies ExportContext;
    return format === "XLSX"
      ? this.generateWorkbook(context)
      : this.generatePdf(context);
  }

  private async generateWorkbook(
    context: ExportContext,
  ): Promise<GeneratedQuotationExport> {
    const template = await loadTemplateWorkbook();
    const source = template.getWorksheet("半包报价模板") ?? template.worksheets[0];
    const coverSource = template.getWorksheet("封面");
    const budgetSource = template.getWorksheet("预算说明书 ");
    if (!source || !coverSource || !budgetSource) {
      throw new Error("报价导出模板缺少封面、预算说明书或半包报价模板");
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "山屿 ERP";
    workbook.created = new Date();
    const cover = copyStaticWorksheet(
      template,
      coverSource,
      workbook,
      "封面",
      4,
      coverSource.rowCount,
    );
    cover.getCell("A4").value = coverSource.getCell("A4").text.replace(
      /项目：.*$/u,
      `项目：${context.quotation.projectAddress}`,
    );
    cover.pageSetup.fitToPage = true;
    cover.pageSetup.fitToWidth = 1;
    cover.pageSetup.fitToHeight = 1;
    const budget = copyStaticWorksheet(
      template,
      budgetSource,
      workbook,
      "预算说明书",
      2,
      budgetSource.rowCount,
    );
    budget.pageSetup.fitToPage = true;
    budget.pageSetup.fitToWidth = 1;
    budget.pageSetup.fitToHeight = 1;

    const sheet = workbook.addWorksheet("半包报价单", {
      properties: { ...source.properties },
      views: source.views.map((view) => ({ ...view })),
    });
    sheet.pageSetup = copyPageSetup(source.pageSetup);
    sheet.headerFooter = structuredClone(source.headerFooter);
    for (let column = 1; column <= 9; column += 1) {
      sheet.getColumn(column).width = source.getColumn(column).width;
      sheet.getColumn(column).hidden = source.getColumn(column).hidden;
      sheet.getColumn(column).style = structuredClone(source.getColumn(column).style);
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
    sheet.getCell("C2").value = context.customerName;
    sheet.getCell("G2").value = number2(context.quotation.outerFrameArea);
    sheet.getCell("I2").value = context.quotation.projectAddress;

    const itemRows = templateItemRows(source);
    let outputRow = 5;
    context.sections.forEach((section, sectionIndex) => {
      const heading = sheet.getRow(outputRow);
      copyStyledRow(source.getRow(5), heading);
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
        const sourceRow = itemRows.get(line.itemName) ?? source.getRow(6);
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
    copyStyledRow(source.getRow(345), summaryHeading);
    sheet.mergeCells(outputRow, 1, outputRow, 3);
    summaryHeading.getCell(1).value = "【十三、工程汇总】";
    outputRow += 1;

    context.summary.rows.forEach((summaryRow) => {
      const target = sheet.getRow(outputRow);
      copyStyledRow(source.getRow(summaryTemplateRow(summaryRow.label)), target);
      target.getCell(2).value = summaryRow.number;
      target.getCell(3).value = summaryRow.label;
      target.getCell(5).value = "元";
      target.getCell(7).value = number2(summaryRow.amount);
      target.getCell(8).value = null;
      target.getCell(9).value = summaryRow.remarks;
      outputRow += 1;
    });

    sheet.pageSetup.printArea = `A1:I${outputRow - 1}`;
    sheet.pageSetup.fitToPage = true;
    sheet.pageSetup.fitToWidth = 1;
    sheet.pageSetup.fitToHeight = 1;
    await addBlankMainMaterialSheet(workbook, context);
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
    const template = await loadTemplateWorkbook();
    await addIntroductoryPdfPages(document, font, template, context);
    const rows = pdfRows(context);
    let page = addLandscapePage(document);
    let section: PdfSection = "HALF";
    setPdfSection(page, section);
    let y = 575;
    for (const row of rows) {
      if (row.kind === "break") {
        section = "MAIN";
        page = addLandscapePage(document);
        setPdfSection(page, section);
        y = 575;
        continue;
      }
      if (y - row.height < 18) {
        page = addLandscapePage(document);
        setPdfSection(page, section);
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

async function loadTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  templateWorkbookPromise ??= (async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await readTemplate()) as never);
    return workbook;
  })();
  return templateWorkbookPromise;
}

async function readMainMaterialTemplate(): Promise<Buffer> {
  const candidates = [
    join(process.cwd(), "assets", mainMaterialTemplateFileName),
    join(process.cwd(), "apps", "api", "assets", mainMaterialTemplateFileName),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`找不到主材报价导出模板：${mainMaterialTemplateFileName}`);
}

async function loadMainMaterialTemplateWorkbook(): Promise<ExcelJS.Workbook> {
  mainMaterialTemplateWorkbookPromise ??= (async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await readMainMaterialTemplate()) as never);
    return workbook;
  })();
  return mainMaterialTemplateWorkbookPromise;
}

export function buildQuotationExportSummary(
  quotation: QuotationDraft,
): QuotationExportSummary {
  const beforeAdjustment = addDecimal4(
    quotation.directCost,
    quotation.managementFee,
  );
  const adjustmentApproved =
    quotation.status === "APPROVED" &&
    quotation.adjustmentStatus === "CONFIRMED" &&
    (decimal4Units(quotation.discountRate) !== 10_000n ||
      decimal4Units(quotation.writeOff) !== 0n);
  const taxableTotal = adjustmentApproved
    ? quotation.adjustedTotal
    : beforeAdjustment;
  const taxAmount = multiplyDecimal4(taxableTotal, "0.0600");
  const rows: QuotationExportSummaryRow[] = [
    {
      amount: quotation.directCost,
      label: "直接费",
      number: "（1）",
      remarks: "",
    },
    {
      amount: quotation.managementFee,
      label: "管理费",
      number: "（2）",
      remarks: "管理费统一按工程总价10%计算。",
    },
  ];
  if (adjustmentApproved) {
    rows.push({
      amount: subtractDecimal4(taxableTotal, beforeAdjustment),
      label: "折扣和抹零",
      number: "（3）",
      remarks: `获批折扣率 ${formatPercentage(quotation.discountRate)}，抹零 ${formatDecimal2(quotation.writeOff)} 元。`,
    });
  }
  rows.push(
    {
      amount: taxAmount,
      label: "税金",
      number: adjustmentApproved ? "（4）" : "（3）",
      remarks: "固定为工程总价6%",
    },
    {
      amount: addDecimal4(taxableTotal, taxAmount),
      label: "总造价",
      number: adjustmentApproved ? "（5）" : "（4）",
      remarks: "",
    },
  );
  return {
    grandTotal: addDecimal4(taxableTotal, taxAmount),
    rows,
    taxableTotal,
    taxAmount,
    taxRate: "0.0600",
  };
}

function summaryTemplateRow(label: QuotationExportSummaryRow["label"]): number {
  if (label === "直接费") return 346;
  if (label === "管理费") return 347;
  if (label === "总造价") return 349;
  return 348;
}

function copyStaticWorksheet(
  sourceWorkbook: ExcelJS.Workbook,
  sourceSheet: ExcelJS.Worksheet,
  targetWorkbook: ExcelJS.Workbook,
  targetName: string,
  lastColumn: number,
  lastRow: number,
): ExcelJS.Worksheet {
  const targetSheet = targetWorkbook.addWorksheet(targetName, {
    properties: structuredClone(sourceSheet.properties),
    views: structuredClone(sourceSheet.views),
  });
  targetSheet.pageSetup = copyPageSetup(sourceSheet.pageSetup);
  targetSheet.headerFooter = structuredClone(sourceSheet.headerFooter);
  for (let column = 1; column <= lastColumn; column += 1) {
    const sourceColumn = sourceSheet.getColumn(column);
    const targetColumn = targetSheet.getColumn(column);
    targetColumn.width = sourceColumn.width;
    targetColumn.hidden = sourceColumn.hidden;
    targetColumn.outlineLevel = sourceColumn.outlineLevel;
    targetColumn.style = structuredClone(sourceColumn.style);
  }
  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const sourceRow = sourceSheet.getRow(rowNumber);
    const targetRow = targetSheet.getRow(rowNumber);
    targetRow.height = sourceRow.height;
    targetRow.hidden = sourceRow.hidden;
    targetRow.outlineLevel = sourceRow.outlineLevel;
    for (let column = 1; column <= lastColumn; column += 1) {
      const sourceCell = sourceRow.getCell(column);
      const targetCell = targetRow.getCell(column);
      targetCell.style = structuredClone(sourceCell.style);
      if (!sourceCell.isMerged || sourceCell.master.address === sourceCell.address) {
        targetCell.value = structuredClone(sourceCell.value);
      }
      if (sourceCell.note) {
        targetCell.note = structuredClone(sourceCell.note);
      }
      if (sourceCell.dataValidation?.type) {
        targetCell.dataValidation = structuredClone(sourceCell.dataValidation);
      }
    }
  }
  for (const range of sourceSheet.model.merges) targetSheet.mergeCells(range);
  for (const rowBreak of sourceSheet.model.rowBreaks ?? []) {
    targetSheet.getRow(rowBreak.id).addPageBreak(
      rowBreak.min ?? 0,
      rowBreak.max ?? lastColumn - 1,
    );
  }
  copyTemplateImage(sourceWorkbook, sourceSheet, targetWorkbook, targetSheet);
  return targetSheet;
}

const materialTemplateSections = [
  { detail: 6, heading: 5, subtotal: 23 },
  { detail: 25, heading: 24, subtotal: 29 },
  { detail: 31, heading: 30, subtotal: 45 },
  { detail: 47, heading: 46, subtotal: 67 },
  { detail: 69, heading: 68, subtotal: 75 },
  { detail: 77, heading: 76, subtotal: 102 },
  { detail: 104, heading: 103, subtotal: 110 },
  { detail: 112, heading: 111, subtotal: 117 },
  { detail: 119, heading: 118, subtotal: 120 },
  { detail: 122, heading: 121, subtotal: 128 },
] as const;

async function addBlankMainMaterialSheet(
  workbook: ExcelJS.Workbook,
  context: ExportContext,
): Promise<void> {
  const template = await loadMainMaterialTemplateWorkbook();
  const source = template.getWorksheet("主材报价模板 ") ?? template.worksheets[0];
  if (!source) throw new Error("主材报价模板缺少工作表");
  const sheet = workbook.addWorksheet("主材报价单", {
    properties: { ...source.properties },
    views: source.views.map((view) => ({ ...view })),
  });
  sheet.pageSetup = copyPageSetup(source.pageSetup);
  sheet.headerFooter = structuredClone(source.headerFooter);
  for (let column = 1; column <= 9; column += 1) {
    sheet.getColumn(column).width = source.getColumn(column).width;
    sheet.getColumn(column).hidden = source.getColumn(column).hidden;
    sheet.getColumn(column).style = structuredClone(source.getColumn(column).style);
  }
  copyTemplateImage(template, source, workbook, sheet);
  for (let rowNumber = 1; rowNumber <= 4; rowNumber += 1) {
    copyStyledRow(source.getRow(rowNumber), sheet.getRow(rowNumber));
  }
  for (const range of [
    "A1:I1",
    "A2:B2",
    "C2:D2",
    "E2:F2",
    "A3:B4",
    "C3:C4",
    "D3:D4",
    "E3:E4",
    "F3:F4",
    "G3:H3",
    "I3:I4",
  ]) {
    sheet.mergeCells(range);
  }
  sheet.getCell("A1").value = "主材报价明细表";
  sheet.getCell("A2").value = "客户名称：";
  sheet.getCell("C2").value = context.customerName;
  sheet.getCell("E2").value = "建筑面积（㎡）：";
  sheet.getCell("G2").value = number2(context.quotation.outerFrameArea);
  sheet.getCell("H2").value = "工程地址：";
  sheet.getCell("I2").value = context.quotation.projectAddress;
  let outputRow = 5;
  for (const section of materialTemplateSections) {
    copyStyledRow(source.getRow(section.heading), sheet.getRow(outputRow));
    sheet.mergeCells(outputRow, 1, outputRow, 9);
    sheet.getCell(outputRow, 1).value = source.getRow(section.heading).getCell(1).text;
    outputRow += 1;
    copyStyledRow(source.getRow(section.subtotal), sheet.getRow(outputRow));
    sheet.mergeCells(outputRow, 1, outputRow, 7);
    sheet.getCell(outputRow, 1).value = "小计：";
    sheet.getCell(outputRow, 8).value = 0;
    sheet.getCell(outputRow, 9).value = null;
    outputRow += 1;
  }
  copyStyledRow(source.getRow(129), sheet.getRow(outputRow));
  sheet.mergeCells(outputRow, 1, outputRow, 9);
  sheet.getCell(outputRow, 1).value = "【十一、工 程 汇 总】";
  outputRow += 1;
  [
    ["直接费", ""],
    ["服务费", "管理费统一按工程总价10%计算。"],
    ["总造价", ""],
  ].forEach(([label, remarks], index) => {
    const target = sheet.getRow(outputRow);
    copyStyledRow(source.getRow(130 + index), target);
    target.getCell(2).value = `（${index + 1}）`;
    target.getCell(3).value = label;
    target.getCell(5).value = "元";
    target.getCell(7).value = 0;
    target.getCell(8).value = null;
    target.getCell(9).value = remarks;
    outputRow += 1;
  });
  sheet.pageSetup.printArea = `A1:I${outputRow - 1}`;
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
}

function copyPageSetup(
  source: ExcelJS.Worksheet["pageSetup"],
): ExcelJS.Worksheet["pageSetup"] {
  const target = structuredClone(source);
  delete (target as { fitToWidth?: number }).fitToWidth;
  if (!target.fitToPage) {
    delete (target as { fitToHeight?: number }).fitToHeight;
  }
  if (target.verticalDpi === 4_294_967_295) {
    delete (target as { verticalDpi?: number }).verticalDpi;
  }
  if (!(target as { useFirstPageNumber?: boolean }).useFirstPageNumber) {
    delete (target as { firstPageNumber?: number }).firstPageNumber;
  }
  return target;
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
  for (let rowNumber = 5; rowNumber < 345; rowNumber += 1) {
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
          subtotal: scope.subtotal,
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
  readonly kind: "break" | "full" | "table";
  readonly size: number;
}

type PdfSection = "BUDGET" | "COVER" | "HALF" | "MAIN";

async function addIntroductoryPdfPages(
  document: PDFDocument,
  font: PDFFont,
  template: ExcelJS.Workbook,
  context: ExportContext,
): Promise<void> {
  const coverSource = template.getWorksheet("封面");
  const budgetSource = template.getWorksheet("预算说明书 ");
  if (!coverSource || !budgetSource) {
    throw new Error("报价导出模板缺少封面或预算说明书");
  }

  const coverPage = addLandscapePage(document);
  setPdfSection(coverPage, "COVER");
  const coverImagePlacement = coverSource.getImages()[0];
  if (coverImagePlacement) {
    const image = template.getImage(Number(coverImagePlacement.imageId));
    if (image?.buffer && image.extension) {
      const embedded = image.extension === "png"
        ? await document.embedPng(image.buffer)
        : image.extension === "jpeg"
          ? await document.embedJpg(image.buffer)
          : null;
      if (embedded) {
        const scale = Math.min(345 / embedded.width, 225 / embedded.height);
        const width = embedded.width * scale;
        const height = embedded.height * scale;
        coverPage.drawImage(embedded, {
          height,
          width,
          x: (841.89 - width) / 2,
          y: 292,
        });
      }
    }
  }
  drawCenteredText(
    coverPage,
    font,
    coverSource.getCell("A2").text.trim(),
    20,
    185,
  );
  drawCenteredText(
    coverPage,
    font,
    `项目：${context.quotation.projectAddress}`,
    13,
    132,
  );
  drawCenteredText(
    coverPage,
    font,
    coverSource.getCell("A6").text.trim(),
    13,
    90,
  );

  const budgetPage = addLandscapePage(document);
  setPdfSection(budgetPage, "BUDGET");
  drawBudgetWorksheet(budgetPage, font, budgetSource);
}

function drawCenteredText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  y: number,
): void {
  page.drawText(text, {
    font,
    size,
    x: (841.89 - font.widthOfTextAtSize(text, size)) / 2,
    y,
  });
}

function drawBudgetWorksheet(
  page: PDFPage,
  font: PDFFont,
  source: ExcelJS.Worksheet,
): void {
  const left = 18;
  const width = 805;
  const numberWidth = 30;
  const sourceHeights = Array.from(
    { length: 19 },
    (_, index) => source.getRow(index + 1).height ?? 17.6,
  );
  const scale = Math.min(
    1,
    559 / sourceHeights.reduce((sum, height) => sum + height, 0),
  );
  let top = 577;
  sourceHeights.forEach((sourceHeight, index) => {
    const rowNumber = index + 1;
    const height = sourceHeight * scale;
    const bottom = top - height;
    const first = source.getRow(rowNumber).getCell(1).text.trim();
    const second = source.getRow(rowNumber).getCell(2).text.trim();
    if (rowNumber > 2) {
      page.drawRectangle({
        borderColor: rgb(0.25, 0.25, 0.25),
        borderWidth: 0.45,
        height,
        width,
        x: left,
        y: bottom,
      });
    }
    if (rowNumber <= 2) {
      const size = rowNumber === 1 ? 14 : 7;
      const lines = wrapText(first, font, size, width - 16, 2);
      lines.forEach((line, lineIndex) => {
        const x = rowNumber === 1
          ? left + (width - font.widthOfTextAtSize(line, size)) / 2
          : left + 8;
        page.drawText(line, {
          font,
          size,
          x,
          y: top - size - 4 - lineIndex * (size + 2),
        });
      });
    } else {
      page.drawLine({
        color: rgb(0.45, 0.45, 0.45),
        end: { x: left + numberWidth, y: top },
        start: { x: left + numberWidth, y: bottom },
        thickness: 0.35,
      });
      const size = 5.8;
      const maxLines = Math.max(1, Math.floor((height - 4) / (size + 1)));
      page.drawText(first, {
        font,
        size,
        x: left + (numberWidth - font.widthOfTextAtSize(first, size)) / 2,
        y: top - size - 4,
      });
      wrapText(second, font, size, width - numberWidth - 8, maxLines)
        .forEach((line, lineIndex) => page.drawText(line, {
          font,
          size,
          x: left + numberWidth + 4,
          y: top - size - 3 - lineIndex * (size + 1),
        }));
    }
    top = bottom;
  });
}

function setPdfSection(page: PDFPage, section: PdfSection): void {
  page.node.set(PDFName.of("ShanyuSection"), PDFString.of(section));
}

function pdfRows(context: ExportContext): PdfRow[] {
  const rows: PdfRow[] = [
    { background: "none", bold: true, cells: ["基础报价明细表"], height: 34, kind: "full", size: 18 },
    { background: "blue", bold: true, cells: [`客户名称：${context.customerName}    建筑面积（㎡）：${formatDecimal2(context.quotation.outerFrameArea)}    工程地址：${context.quotation.projectAddress}`], height: 28, kind: "full", size: 11 },
    { background: "blue", bold: true, cells: ["编号", "工程项目", "单位", "数量", "单价", "金额", "备注"], height: 30, kind: "table", size: 11 },
  ];
  context.sections.forEach((section, sectionIndex) => {
    rows.push({ background: "blue", bold: true, cells: [sectionHeading(sectionIndex + 1, section.name)], height: 26, kind: "full", size: 11 });
    section.lines.forEach((line, lineIndex) => {
      rows.push({
        background: "none",
        bold: false,
        cells: [String(lineIndex + 1), line.itemName, formatExportUnit(line.unit), formatDecimal2(line.quantity), formatDecimal2(line.saleUnitPrice), formatDecimal2(line.amount), line.remarks ?? ""],
        height: pdfItemRowHeight(line.itemName, line.remarks),
        kind: "table",
        size: 10,
      });
    });
    rows.push({ background: "none", bold: true, cells: ["", "小计", "元", "", "", formatDecimal2(section.subtotal), ""], height: 26, kind: "table", size: 10 });
  });
  rows.push({ background: "blue", bold: true, cells: ["【十三、工程汇总】"], height: 22, kind: "full", size: 9 });
  context.summary.rows.forEach((summaryRow) => rows.push({
    background: "summary",
    bold: true,
    cells: [
      summaryRow.number,
      summaryRow.label,
      "元",
      "",
      "",
      formatDecimal2(summaryRow.amount),
      summaryRow.remarks,
    ],
    height: 22,
    kind: "table",
    size: 8,
  }));
  rows.push({ background: "none", bold: false, cells: [], height: 0, kind: "break", size: 0 });
  rows.push({ background: "none", bold: true, cells: ["主材报价明细表"], height: 34, kind: "full", size: 18 });
  rows.push({ background: "blue", bold: true, cells: [`客户名称：${context.customerName}    工程地址：${context.quotation.projectAddress}`], height: 28, kind: "full", size: 11 });
  rows.push({ background: "blue", bold: true, cells: ["编号", "主材/型号", "单位", "数量", "单价", "金额", "品牌/颜色/规格"], height: 30, kind: "table", size: 11 });
  ["瓷砖", "美缝", "木地板", "房门/门套/玻璃门", "集成吊顶", "卫浴", "淋浴房", "石材/岩板", "开关面板", "定制类"]
    .forEach((name) => {
      rows.push({ background: "blue", bold: true, cells: [`【${name}】`], height: 26, kind: "full", size: 11 });
      rows.push({ background: "none", bold: true, cells: ["", "小计", "元", "", "", "0.00", ""], height: 26, kind: "table", size: 10 });
    });
  [
    ["（1）", "直接费", "0.00", ""],
    ["（2）", "服务费", "0.00", "管理费统一按工程总价10%计算。"],
    ["（3）", "总造价", "0.00", ""],
  ].forEach(([number, label, amount, remarks]) => rows.push({
    background: "summary",
    bold: true,
    cells: [number ?? "", label ?? "", "元", "", "", amount ?? "0.00", remarks ?? ""],
    height: 22,
    kind: "table",
    size: 8,
  }));
  return rows;
}

function addLandscapePage(document: PDFDocument): PDFPage {
  return document.addPage([841.89, 595.28]);
}

function drawPdfRow(page: PDFPage, font: PDFFont, top: number, row: PdfRow): void {
  if (row.kind === "break") return;
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
  return Number(formatDecimal2(value));
}

function number4(value: string): number {
  return Number.parseFloat(Number.parseFloat(value).toFixed(4));
}

function exportFileName(quotation: QuotationDraft, extension: "pdf" | "xlsx"): string {
  return `${safeName(quotation.projectAddress)}_项目报价单_V${quotation.versionNumber}.${extension}`;
}

function addDecimal4(left: string, right: string): string {
  return fixed4(decimal4Units(left) + decimal4Units(right));
}

function subtractDecimal4(left: string, right: string): string {
  return fixed4(decimal4Units(left) - decimal4Units(right));
}

function multiplyDecimal4(left: string, right: string): string {
  const product = decimal4Units(left) * decimal4Units(right);
  const rounded = product >= 0n
    ? (product + 5_000n) / 10_000n
    : (product - 5_000n) / 10_000n;
  return fixed4(rounded);
}

function formatDecimal2(value: string): string {
  const units = decimal4Units(value);
  const rounded = units >= 0n
    ? (units + 50n) / 100n
    : (units - 50n) / 100n;
  const sign = rounded < 0n ? "-" : "";
  const absolute = rounded < 0n ? -rounded : rounded;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function formatPercentage(value: string): string {
  return `${formatDecimal2(fixed4(decimal4Units(value) * 100n))}%`;
}

function decimal4Units(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) throw new Error("导出金额格式不正确");
  const units = BigInt(match[2] ?? "0") * 10_000n +
    BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] === "-" ? -units : units;
}

function fixed4(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  return `${sign}${absolute / 10_000n}.${String(absolute % 10_000n).padStart(4, "0")}`;
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-");
}
