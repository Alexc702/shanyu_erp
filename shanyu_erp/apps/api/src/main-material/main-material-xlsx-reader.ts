import { posix } from "node:path";
import { createRequire } from "node:module";
import ExcelJS from "exceljs";
import JSZip from "jszip";

// saxes' published .d.ts has unconstrained generics under TS 5.9. Keep the
// narrow event adapter typed locally rather than disabling library checks globally.
interface SaxesTagNS {
  local: string;
  uri: string;
  attributes: Record<string, { local: string; uri: string; value: string }>;
}
interface XmlParser {
  on(event: "opentag" | "closetag", callback: (tag: SaxesTagNS) => void): void;
  on(event: "text" | "cdata" | "doctype", callback: (text: string) => void): void;
  write(xml: string): XmlParser;
  close(): void;
}
const { SaxesParser } = createRequire(__filename)("saxes") as {
  SaxesParser: new (options: { xmlns: true }) => XmlParser;
};

export class MainMaterialWorkbookReadError extends Error {}

const mainNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Import values, not presentation objects. Namespace prefixes are arbitrary in OOXML;
// tables, styles and drawings must not prevent reading the business cells.
export async function readMainMaterialXlsx(buffer: Buffer): Promise<ExcelJS.Workbook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch {
    throw new MainMaterialWorkbookReadError("无法读取 XLSX 压缩包，文件可能损坏或已加密");
  }
  let totalBytes = 0;
  const xml = async (path: string): Promise<string> => {
    const entry = zip.file(path);
    if (!entry) throw new MainMaterialWorkbookReadError(`Excel 结构不兼容：缺少 ${path}`);
    const data = await entry.async("string");
    totalBytes += Buffer.byteLength(data);
    if (totalBytes > 64 * 1024 * 1024) throw new MainMaterialWorkbookReadError("Excel 业务数据超过读取上限");
    return data;
  };
  const relationships = new Map<string, string>();
  parse(await xml("xl/_rels/workbook.xml.rels"), (tag) => {
    if (tag.local === "Relationship" && attr(tag, "TargetMode") !== "External") {
      const target = attr(tag, "Target");
      const path = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join("xl", target));
      if (!path.startsWith("xl/")) throw new MainMaterialWorkbookReadError("Excel 工作表关系路径无效");
      relationships.set(attr(tag, "Id"), path);
    }
  });
  const sheets: { name: string; path: string }[] = [];
  parse(await xml("xl/workbook.xml"), (tag) => {
    if (tag.local !== "sheet" || tag.uri !== mainNamespace) return;
    const name = attr(tag, "name");
    if (!["主材库", "Delta导入模板", "玻璃门选型"].includes(name)) return;
    const id = Object.values(tag.attributes).find((a) => a.uri === relationNamespace && a.local === "id")?.value;
    const path = id && relationships.get(id);
    if (!path) throw new MainMaterialWorkbookReadError(`Excel 工作表关系不完整：${name}`);
    sheets.push({ name, path });
  });
  const strings: string[] = [];
  if (zip.file("xl/sharedStrings.xml")) {
    let value = "";
    let reading = false;
    parse(await xml("xl/sharedStrings.xml"), (tag) => {
      if (tag.local === "si") value = "";
      if (tag.local === "t") reading = true;
    }, (text) => { if (reading) value += text; }, (tag) => {
      if (tag.local === "t") reading = false;
      if (tag.local === "si") strings.push(value);
    });
  }
  const workbook = new ExcelJS.Workbook();
  for (const source of sheets) {
    const sheet = workbook.addWorksheet(source.name);
    let address = "", type = "", value = "", reading = false, formula = false, cached = false;
    parse(await xml(source.path), (tag) => {
      if (tag.uri !== mainNamespace) return;
      if (tag.local === "c") {
        address = attr(tag, "r"); type = attr(tag, "t"); value = ""; formula = false; cached = false;
      }
      if (tag.local === "f") formula = true;
      if (tag.local === "v") cached = true;
      if (tag.local === "v" || tag.local === "t") reading = true;
    }, (text) => { if (reading) value += text; }, (tag) => {
      if (tag.local === "v" || tag.local === "t") reading = false;
      if (tag.local !== "c" || !address) return;
      if (!/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(address)) throw new MainMaterialWorkbookReadError("Excel 单元格地址超出支持范围");
      if (formula && !cached) throw new MainMaterialWorkbookReadError(`Excel 公式缺少缓存值：${source.name}!${address}，请在 Excel 重算并保存`);
      const resolved = type === "s" ? strings[Number(value)] : value;
      if (resolved === undefined) throw new MainMaterialWorkbookReadError(`Excel 共享字符串索引无效：${address}`);
      sheet.getCell(address).value = resolved;
    });
  }
  return workbook;
}

function attr(tag: SaxesTagNS, name: string): string {
  return Object.values(tag.attributes).find((a) => a.local === name)?.value ?? "";
}

function parse(
  xml: string,
  open: (tag: SaxesTagNS) => void,
  text: (value: string) => void = () => {},
  close: (tag: SaxesTagNS) => void = () => {},
): void {
  try {
    const parser = new SaxesParser({ xmlns: true });
    parser.on("doctype", () => { throw new MainMaterialWorkbookReadError("Excel XML 不允许 DTD"); });
    parser.on("opentag", open);
    parser.on("text", text);
    parser.on("cdata", text);
    parser.on("closetag", close);
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof MainMaterialWorkbookReadError) throw error;
    throw new MainMaterialWorkbookReadError("Excel XML 结构无法解析，请另存为标准 .xlsx 后重试");
  }
}
