import { BadRequestException } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { createHash } from "node:crypto";
import type { MainMaterialQuotation, MainMaterialRepository } from "../main-material/main-material.repository";
import { isMainMaterialColorSelectionValid } from "../main-material/main-material-selection";
import { readPdfFont, readPdfStaticAsset, type GeneratedQuotationExport } from "./quotation-exporter";

export interface SelectionSheetSnapshot {
  readonly templateVersion: "0920-v1";
  readonly project: string;
  readonly customer: string;
  readonly designer: string;
  readonly version: number;
  readonly date: string;
  readonly rows: readonly SelectionSheetRow[];
}
interface SelectionSheetRow {
  readonly category: string;
  readonly name: string;
  readonly brand: string;
  readonly color: string;
  readonly spec: string;
  readonly description: string;
  readonly locations: readonly string[];
}

/** Explicit customer fields only: never serialize item records, prices or remarks. */
export async function buildSelectionSheetRows(quotation: MainMaterialQuotation | null, repository: MainMaterialRepository): Promise<readonly SelectionSheetRow[]> {
  if (!quotation) throw new BadRequestException("当前版本没有可导出的选材内容");
  const rows = new Map<string, SelectionSheetRow>();
  for (const line of quotation.lines) {
    if (!line.itemVersionId || !line.materialId || Number(line.quantity) <= 0) continue;
    const item = await repository.findItem(line.itemVersionId);
    if (!item || item.catalogVersionId !== quotation.catalog.id || item.materialId !== line.materialId) {
      throw new BadRequestException("选材版本关联异常，请核对后重试");
    }
    const hasColor = item.colors.length > 0 || Boolean(item.attributes.glassColors && item.attributes.glassColors !== "[]");
    if (!hasColor) continue;
    if (!isMainMaterialColorSelectionValid(item, line.selectedColor)) {
      throw new BadRequestException(`${safeText(line.itemName ?? "主材")} 尚未完成颜色选择`);
    }
    if (line.assetIds.some(id => !item.assetIds.includes(id))) throw new BadRequestException("选材图片关联与绑定版本不一致");
    const location = safeText(line.scopeName === "项目级" || line.scopeName === "全屋" ? "使用位置未注明" : line.scopeName);
    const row: SelectionSheetRow = {
      category: safeText(item.categoryName), name: safeText(line.itemName ?? item.itemName),
      brand: safeText(line.brand ?? ""), color: safeText(line.selectedColor ?? ""), spec: safeText(line.spec ?? ""),
      description: [line.materialId === "MAT-GLASS_DOOR-FBACE026D73F" ? "门框色卡，非产品实景。"
        : item.attributes.variantGroup?.startsWith("定制浴室柜:") ? "核心主材纹理示意，非整柜实景。" : "",
        ...technicalFields(item.categoryCode).flatMap(([key, label]) => item.attributes[key] ? [`${label}：${safeText(item.attributes[key]!)}`] : []),
      ].filter(Boolean).join("\n"),
      locations: [location || "使用位置未注明"],
    };
    const key = createHash("sha256").update(JSON.stringify([item.id, item.recordVersion, line.spec, line.selectedColor, item.attributes, line.assetIds])).digest("hex");
    const previous = rows.get(key);
    rows.set(key, previous ? { ...previous, locations: [...new Set([...previous.locations, ...row.locations])] } : row);
  }
  if (!rows.size) throw new BadRequestException("当前版本没有需要确认颜色的已选主材，不能生成空选材单");
  return [...rows.values()];
}

function safeText(value: string): string {
  // Customer-facing typed fields can still contain accidentally pasted contact information.
  return Array.from(value.replace(/(?:https?:\/\/|www\.)\S+/gi, "").replace(/1[3-9]\d{9}/g, "").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, ""), character => character.charCodeAt(0) < 32 ? " " : character).join("").trim();
}

export async function renderSelectionSheet(snapshot: SelectionSheetSnapshot): Promise<GeneratedQuotationExport> {
  if (snapshot.templateVersion !== "0920-v1") throw new Error("不支持的选材单快照模板版本");
  const document = new PDFDocument({ autoFirstPage: false, bufferPages: true, size: "A4", margin: 36,
    info: { Title: "项目选材单", Creator: "山屿 ERP", Producer: "山屿 ERP" } });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("data", chunk => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject);
  });
  document.registerFont("NotoSansSC", await readPdfFont()).font("NotoSansSC");
  const logo = await readPdfStaticAsset("cover-logo.png");
  document.addPage();
  document.image(logo, 430, 36, { fit: [129, 80] });
  document.fontSize(23).text("项目选材单", 36, 85, { width: 523 });
  document.fontSize(10).fillColor("#71717a").text("CUSTOM DESIGN", 36, 118, { width: 300 }).fillColor("#18181b");
  const coverFields = [["项目名称", snapshot.project], ["项目地址", snapshot.project], ["客户称呼", snapshot.customer || "未提供"], ["主案设计师", snapshot.designer || "未提供"], ["来源报价版本", `V${snapshot.version}`], ["生成日期", snapshot.date]];
  let coverY = 165;
  for (const [label, value] of coverFields) {
    document.fontSize(12);
    const lines = wrap(document, safeText(value!), 395);
    for (let offset = 0; offset < lines.length;) {
      if (coverY + 40 > 720) { document.addPage(); coverY = 50; }
      const take = Math.min(lines.length - offset, Math.floor((720 - coverY - 16) / 18));
      const height = Math.max(40, take * 18 + 16);
      document.fontSize(10.5).fillColor("#71717a").text(offset ? `${label}（续）` : label!, 36, coverY, { width: 120 });
      document.fontSize(12).fillColor("#18181b");
      lines.slice(offset, offset + take).forEach((line, index) => document.text(line, 164, coverY + index * 18, { lineBreak: false }));
      document.lineWidth(0.4).strokeColor("#e4e4e7").moveTo(36, coverY + height - 12).lineTo(559, coverY + height - 12).stroke();
      coverY += height; offset += take;
    }
  }
  if (coverY > 450) { document.addPage(); coverY = 50; }
  const confirmationPage = document.bufferedPageRange().count - 1;
  const confirmationY = Math.max(500, coverY + 70);
  document.fontSize(14).text("选材确认", 36, confirmationY, { width: 523 });
  document.fontSize(13).text("客户签字：________________________", 36, confirmationY + 108, { width: 523 });
  document.text("日期：________年______月______日", 36, confirmationY + 152, { width: 523 });
  const widths = [80, 78, 65, 94, 90, 116];
  const labels = ["主材名称", "图示", "品牌", "颜色", "规格", "材料说明"];
  let y = 0, category = "";
  function newPage(name: string) {
    document.addPage(); document.fontSize(16).fillColor("#18181b").text(name, 36, 42, { width: 523 });
    document.image(logo, 489, 28, { fit: [70, 44] });
    y = 80; drawCells(labels, 32, true); y += 32;
  }
  function drawCells(values: readonly string[], height: number, heading = false) {
    let x = 36;
    values.forEach((value, index) => {
      const width = widths[index]!;
      if (heading) document.rect(x, y, width, height).fill("#f4f4f5");
      document.rect(x, y, width, height).lineWidth(0.4).strokeColor("#d4d4d8").stroke();
      document.fillColor("#18181b").fontSize(10);
      value.split("\n").forEach((line, lineIndex) => document.text(line, x + 6, y + 8 + lineIndex * 17, { lineBreak: false }));
      x += width;
    });
  }
  for (const row of snapshot.rows) {
    if (category !== row.category) { category = row.category; newPage(category); }
    const values = [row.name, "产品图待补充", row.brand || "未提供", row.color, row.spec || "未提供", [row.description || "暂无补充说明。", `使用位置：${row.locations.join("、")}`].join("\n")];
    document.fontSize(10);
    const lines = values.map((value, index) => wrap(document, value, widths[index]! - 12));
    const count = Math.max(...lines.map(value => value.length));
    let offset = 0;
    while (offset < count) {
      if (y + 46 > 755) newPage(`${category}（续）`);
      const take = Math.max(1, Math.min(count - offset, Math.floor((755 - y - 16) / 17)));
      const height = Math.max(64, take * 17 + 16);
      if (y + height > 755) { newPage(`${category}（续）`); continue; }
      drawCells(lines.map(value => value.slice(offset, offset + take).join("\n")), height);
      y += height; offset += take;
    }
  }
  const pages = document.bufferedPageRange().count;
  for (let page = 0; page < pages; page++) {
    document.switchToPage(page);
    document.page.margins.bottom = 0;
    if (page === confirmationPage) {
      document.fontSize(10.5).fillColor("#71717a").text("清单总页数", 36, coverY, { width: 120 });
      document.fontSize(12).fillColor("#18181b").text(`${pages} 页（含本页）`, 164, coverY, { width: 395 });
      document.fontSize(12).text(`本人确认本选材单所列材料及颜色，清单对应报价版本 V${snapshot.version}，共 ${pages} 页。`, 36, confirmationY + 44, { width: 523 });
    }
    document.fontSize(10).fillColor("#71717a").text("本手册对应所示报价版本的已选材料；图片与实物可能存在色差，规格及选型以该版本确认内容为准。", 36, 758, { width: 523 });
    document.fontSize(8).text("版权注册：山屿设计 SHANYU DESIGN STUDIO", 36, 800, { width: 350, lineBreak: false });
    document.text(`V${snapshot.version} · 第 ${page + 1} / ${pages} 页`, 400, 800, { width: 159, align: "right", lineBreak: false });
  }
  document.end();
  return { contentType: "application/pdf", fileName: `${snapshot.project.replace(/[\\/:*?"<>|\r\n]/g, "_")}_选材单_V${snapshot.version}.pdf`, payload: await completed };
}

function technicalFields(category: string): readonly (readonly [string, string])[] {
  if (category === "FLOOR") return [["woodSpecies", "木种"], ["substrate", "基材"], ["thickness", "厚度"], ["grade", "等级"], ["lockType", "锁扣"]];
  if (category === "CEILING") return [["panelSize", "板材规格"], ["lightingPower", "功率"]];
  if (category === "STONE" || category === "GLASS_DOOR") return [["thickness", "厚度"]];
  return [];
}

function wrap(document: PDFKit.PDFDocument, text: string, width: number): string[] {
  const lines: string[] = []; let line = "";
  for (const character of text) {
    if (character === "\n" || document.widthOfString(line + character) > width) {
      lines.push(line); line = character === "\n" ? "" : character;
    } else line += character;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
