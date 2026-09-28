import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { posix } from "node:path";
import { dirname, resolve } from "node:path";
import { link, mkdir, mkdtemp, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";
import type { DirectMaterialProcessingStage } from "@shanyu/contracts";

export const directParserVersion = "direct-xlsx-1";
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export async function storeDirectFile(path: string, payload: Buffer): Promise<void> {
  await mkdir(dirname(path),{recursive:true,mode:0o750});
  const temporary=await mkdtemp(resolve(dirname(path),".direct-write-")),file=resolve(temporary,"payload");
  try{
    await writeFile(file,payload,{flag:"wx",mode:0o600});
    try{await link(file,path);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;if(hash(await readFile(path))!==hash(payload))throw new Error("已归档内容不一致");}
  }finally{await unlink(file).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;});await rmdir(temporary);}
}
export async function cacheDirectAsset(id: string, payload: Buffer): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(id) || hash(payload)!==id) throw new Error("导入图片内容校验失败");
  const storagePath=`main-materials/imported/${id}.png`;
  let root=resolve(process.cwd(),"assets");
  try{await stat(resolve(process.cwd(),"apps/api/assets"));root=resolve(process.cwd(),"apps/api/assets");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const path=resolve(root,storagePath);await storeDirectFile(path,payload);
  return storagePath;
}
export interface XmlNode { name: string; attrs: Record<string, string>; text: string; children: XmlNode[] }
interface XmlTag { local: string; attributes: Record<string, { local: string; value: string }> }
interface XmlParser {
  on(event: "opentag" | "closetag", callback: (tag: XmlTag) => void): void;
  on(event: "text" | "cdata" | "doctype", callback: (text: string) => void): void;
  write(xml: string): XmlParser; close(): void;
}
const { SaxesParser } = createRequire(__filename)("saxes") as { SaxesParser: new (options: { xmlns: true }) => XmlParser };
export function xmlTree(xml: string): XmlNode {
  const root: XmlNode = { name: "root", attrs: {}, text: "", children: [] }, stack = [root];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new Error("不允许 DTD"); });
  parser.on("opentag", tag => {
    const node: XmlNode = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(a => [a.local, a.value])), text: "", children: [] };
    stack.at(-1)!.children.push(node); stack.push(node);
  });
  parser.on("closetag", () => { stack.pop(); });
  parser.on("text", text => { stack.at(-1)!.text += text; });
  parser.on("cdata", text => { stack.at(-1)!.text += text; });
  parser.write(xml).close(); return root;
}
export function descendants(node: XmlNode, name: string): XmlNode[] {
  return node.children.flatMap(c => [...(c.name === name ? [c] : []), ...descendants(c, name)]);
}
function child(node: XmlNode, name: string) { return node.children.find(c => c.name === name); }
function allText(node: XmlNode): string { return node.text + node.children.map(allText).join(""); }
export class DirectFileError extends Error {
  constructor(readonly kind: "CORRUPT" | "UNSUPPORTED", message: string) { super(message); }
}
export interface DirectImage {
  originalHash: string; visibleHash: string; original: string; visible: string; source: string;
  transform: { crop: number[]; rotation: number; flipH: boolean; flipV: boolean; width: number; height: number };
}
export interface DirectSourceRow { row: number; values: Record<string, string>; cells: Record<string, string>; images: DirectImage[]; issues: string[] }
export interface DirectSourceSheet { name: string; headerRow: number; headers: Record<string, string>; rows: DirectSourceRow[] }
export interface DirectSource { parserVersion: string; fileHash: string; sheets: DirectSourceSheet[]; ignoredSheets: string[] }
const aliases: Record<string, string[]> = {
  categoryCode: ["分类", "分类代码", "主材分类", "类别"], itemName: ["品名", "品名/项目", "项目", "商品名称", "产品名称"],
  brand: ["品牌"], model: ["型号", "产品型号", "商品型号"], spec: ["规格", "规格尺寸", "规格(mm)", "尺寸"],
  process: ["工艺"], series: ["系列", "系列/工艺"], colors: ["颜色", "可选颜色", "颜色/可选颜色"],
  unit: ["单位", "计价单位"], costPrice: ["成本", "成本价", "成本价（敏感）", "采购价"],
  salePrice: ["售价", "销售价", "销售单价", "零售价"], ambiguousPrice: ["价格/平方", "单价", "价格", "价格/平方米"],
  image: ["产品图", "产品图片", "图片", "图片文件名"], remarks: ["备注", "说明"], materialId: ["material_id"],
};
const normalizedHeader = (s: string) => s.normalize("NFKC").replace(/\s/g, "").toLowerCase();
const fieldFor = (s: string) => Object.entries(aliases).find(([, names]) => names.some(n => normalizedHeader(n) === normalizedHeader(s)))?.[0];

export async function readDirectMaterialFile(buffer: Buffer, paired: readonly { name: string; buffer: Buffer }[] = [], progress?: (stage: DirectMaterialProcessingStage) => void): Promise<DirectSource> {
  progress?.("READING");
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer, { checkCRC32: true }); } catch { throw new DirectFileError("CORRUPT", "文件损坏、加密或不是可打开的 .xlsx 文件，请重新选择。"); }
  let bytes = 0;
  const data = async (path: string) => {
    const entry = zip.file(path); if (!entry) throw new Error(`缺少 ${path}`);
    const value = await entry.async("nodebuffer"); bytes += value.length;
    if (value.length > 24 * 1024 * 1024 || bytes > 128 * 1024 * 1024) throw new Error("解压内容超过读取上限");
    return value;
  };
  const tree = async (path: string) => xmlTree((await data(path)).toString("utf8"));
  const relations = async (path: string) => {
    const relPath = posix.join(posix.dirname(path), "_rels", `${posix.basename(path)}.rels`);
    if (!zip.file(relPath)) return new Map<string, string>();
    return new Map(descendants(await tree(relPath), "Relationship").filter(r => r.attrs.TargetMode !== "External").map(r => {
      const target = r.attrs.Target!, resolved = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join(posix.dirname(path), target));
      if (!resolved.startsWith("xl/")) throw new Error("图片或工作表关系路径无效");
      return [r.attrs.Id!, resolved];
    }));
  };
  try {
    const strings = zip.file("xl/sharedStrings.xml") ? descendants(await tree("xl/sharedStrings.xml"), "si").map(n => descendants(n, "t").map(allText).join("")) : [];
    const book = await tree("xl/workbook.xml"), bookRels = await relations("xl/workbook.xml");
    const styles = zip.file("xl/styles.xml") ? await tree("xl/styles.xml") : null;
    const formats = new Map(styles ? descendants(styles,"numFmt").map(node => [node.attrs.numFmtId,node.attrs.formatCode]) : []);
    const cellStyles = styles ? descendants(styles,"cellXfs")[0]?.children ?? [] : [];
    const sheets: DirectSourceSheet[] = [], ignoredSheets: string[] = [];
    const wps = new Map<string, { pic: XmlNode; source: string }>(), ambiguousWps = new Set<string>();
    if (zip.file("xl/cellimages.xml")) {
      const rels = await relations("xl/cellimages.xml");
      for (const pic of descendants(await tree("xl/cellimages.xml"), "pic")) {
        const name = descendants(pic, "cNvPr")[0]?.attrs.name;
        const source = rels.get(descendants(pic, "blip")[0]?.attrs.embed ?? "");
        if (name && source) { if(wps.has(name)) ambiguousWps.add(name);wps.set(name, { pic, source }); }
      }
    }
    for (const source of descendants(book, "sheet")) {
      const name = source.attrs.name!, path = bookRels.get(source.attrs.id!);
      if (!path) throw new Error(`工作表关系不完整：${name}`);
      const sheetXml = await tree(path);
      const sourceRows = descendants(sheetXml, "row").map(row => ({ number: Number(row.attrs.r), cells: row.children.filter(c => c.name === "c") }));
      const value = (cell: XmlNode) => {
        const raw = child(cell, "v")?.text ?? "";
        return cell.attrs.t === "s" ? strings[Number(raw)] ?? "" : cell.attrs.t === "inlineStr" ? descendants(cell, "t").map(allText).join("") : raw;
      };
      const possible = sourceRows.filter(r => r.number <= 100).map(row => {
        const mapped = row.cells.map(c => ({ col: c.attrs.r!.replace(/\d/g, ""), field: fieldFor(value(c)), label: value(c) })).filter(c => c.field);
        const fields = mapped.map(c => c.field);
        const valid = (fields.includes("model") || fields.includes("itemName")) && (fields.includes("spec") || fields.includes("unit"))
          && fields.some(f => ["salePrice", "costPrice", "ambiguousPrice"].includes(f!))
          && fields.some(f => ["brand", "itemName", "categoryCode"].includes(f!));
        return { row, mapped, valid };
      }).filter(r => r.valid);
      if (!possible.length) { ignoredSheets.push(name); continue; }
      if (possible.length !== 1) throw new DirectFileError("UNSUPPORTED", `${name} 存在多个商品表区域，无法可靠定位表头，请参考文件格式整理后重试。`);
      const found = possible[0]!;
      if (new Set(found.mapped.map(m => m.field)).size !== found.mapped.length) throw new DirectFileError("UNSUPPORTED", `${name} 的同义字段重复，无法确定读取列。`);
      const rows: DirectSourceRow[] = [];
      for (const r of sourceRows.filter(r => r.number > found.row.number)) {
        const values: Record<string, string> = {}, cells: Record<string, string> = {}, issues: string[] = [];
        for (const m of found.mapped) {
          const c = r.cells.find(c => c.attrs.r === `${m.col}${r.number}`);
          if (!c) continue;
          const formula = child(c, "f"), address = `${name}!${c.attrs.r}`;
          let display = value(c).trim();
          const mask = formats.get(cellStyles[Number(c.attrs.s ?? 0)]?.attrs.numFmtId);
          if (m.field === "model" && !["s","inlineStr","str"].includes(c.attrs.t ?? "") && mask && /^0+$/.test(mask) && /^\d+$/.test(display)) display = display.padStart(mask.length,"0");
          if (formula && /DISPIMG\s*\(/i.test(formula.text)) values.image = formula.text;
          else if (formula && (!child(c, "v") || c.attrs.t === "e" || !display)) issues.push(`${address}：公式无有效缓存结果，请填写数值或重算保存`);
          else if (c.attrs.t === "e") issues.push(`${address}：单元格错误 ${display}`);
          else values[m.field!] = display;
          cells[m.field!] = address;
        }
        for(const c of r.cells.filter(c=>!found.mapped.some(m=>`${m.col}${r.number}`===c.attrs.r))){
          const formula=child(c,"f")?.text;
          if(!formula||!/DISPIMG\s*\(/i.test(formula))continue;
          if(values.image && values.image!==formula)issues.push(`${name}!${c.attrs.r}：同一商品行存在多重图片单元格，请核实归属`);
          else values.image=formula;
        }
        if (!values.model && !values.itemName && !values.brand && !issues.length) continue;
        rows.push({ row: r.number, values, cells, images: [], issues });
        if (rows.length > 10_000) throw new Error("商品超过单批读取上限");
      }
      const output: DirectSourceSheet = { name, headerRow: found.row.number, headers: Object.fromEntries(found.mapped.map(m => [m.field!, m.label])), rows };
      const sheetRels = await relations(path);
      if (descendants(sheetXml, "drawing").length || rows.some(row => row.values.image)) progress?.("IMAGES");
      for (const d of descendants(sheetXml, "drawing")) {
        const drawingPath = sheetRels.get(d.attrs.id!); if (!drawingPath) throw new Error("工作表图片关系不完整");
        const drawing = await tree(drawingPath), rels = await relations(drawingPath);
        for (const anchor of drawing.children.flatMap(root => root.children)) {
          const from = child(anchor, "from"), to = child(anchor, "to");
          const row = Number(child(from ?? anchor, "row")?.text) + 1;
          const target = rows.find(r => r.row === row);
          if (!target) {
            if (!from) rows.forEach(item => item.issues.push(`${name}：图片没有可定位商品行的锚点，请检查或排除`));
            else if (row > found.row.number) rows.forEach(item => item.issues.push(`${name}!第${row}行：图片锚定非商品行，归属不明确`));
            continue;
          }
          const end = to ? Number(child(to, "row")?.text) + 1 : row;
          const ambiguous = end > row && !(end === row + 1 && Number(child(to!, "rowOff")?.text) === 0);
          const pic = child(anchor, "pic"), col = child(from ?? anchor, "col")?.text;
          const expectedCol = found.mapped.find(m => m.field === "image")?.col;
          if (ambiguous || !pic || (expectedCol && columnNumber(expectedCol) !== Number(col))) {
            target.issues.push(`${name}!第${row}行：图片跨行、错列或锚点无法确定，请更正原文件或排除`); continue;
          }
          const sourcePath = rels.get(descendants(pic, "blip")[0]?.attrs.embed ?? "");
          try { if (!sourcePath) throw new Error("图片关系缺失"); target.images.push(await renderDirectImage(await data(sourcePath), pic, `${name}!第${row}行/${sourcePath}`)); }
          catch (error) { target.issues.push(`${name}!第${row}行：图片无法还原（${error instanceof Error ? error.message : "不可读"}）`); }
        }
      }
      for (const row of rows) {
        const ref = row.values.image;
        if (!ref) continue;
        const id = /DISPIMG\s*\(\s*"([^"]+)"/i.exec(ref)?.[1];
        try {
          if (id) {
            if(ambiguousWps.has(id))throw new Error("WPS 图片标识同名歧义，不能确定来源");
            const source = wps.get(id); if (!source) throw new Error("WPS 图片单元格关系缺失");
            row.images.push(await renderDirectImage(await data(source.source), source.pic, `${name}!第${row.row}行/${id}`));
          } else {
            const matches = paired.filter(f => f.name === ref);
            if (matches.length !== 1) throw new Error("配套图片文件名缺失或同名歧义");
            row.images.push(await renderDirectImage(matches[0]!.buffer, { name: "pic", attrs: {}, text: "", children: [] }, `${name}!第${row.row}行/${ref}`));
          }
        } catch (error) { row.issues.push(`${name}!第${row.row}行：${error instanceof Error ? error.message : "图片无效"}`); }
      }
      if (rows.length) sheets.push(output);
    }
    if (!sheets.length) throw new DirectFileError("UNSUPPORTED", "未找到可可靠识别的按行商品表。请参考文件格式填写后重试；替换 Sheet2 示例资料，忽略 Sheet1 历史资料。");
    return { parserVersion: directParserVersion, fileHash: hash(buffer), sheets, ignoredSheets };
  } catch (error) {
    if (error instanceof DirectFileError) throw error;
    throw new DirectFileError("CORRUPT", `Excel 结构或关系无法读取：${error instanceof Error ? error.message : "无效 XML"}`);
  }
}
function columnNumber(col: string) { return [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1; }

export async function renderDirectImage(buffer: Buffer, pic: XmlNode, source: string): Promise<DirectImage> {
  const cropNode = descendants(pic, "srcRect")[0], xfrm = descendants(pic, "xfrm")[0], ext = xfrm && child(xfrm, "ext");
  const crop = ["l", "t", "r", "b"].map(key => Number(cropNode?.attrs[key] ?? 0) / 100_000);
  const rotation = Number(xfrm?.attrs.rot ?? 0) / 60_000;
  const flipH = ["1", "true"].includes(xfrm?.attrs.flipH ?? ""), flipV = ["1", "true"].includes(xfrm?.attrs.flipV ?? "");
  const metadata = await sharp(buffer, { limitInputPixels: 36_000_000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.pages && metadata.pages > 1) throw new Error("图片尺寸或格式无效");
  if (crop.some(c => !Number.isFinite(c) || c < 0 || c >= 1) || crop[0]! + crop[2]! >= 1 || crop[1]! + crop[3]! >= 1 || !Number.isFinite(rotation)) throw new Error("裁剪或旋转参数不支持");
  const left = Math.round(metadata.width * crop[0]!), top = Math.round(metadata.height * crop[1]!);
  const width = Math.max(1, metadata.width - left - Math.round(metadata.width * crop[2]!)), height = Math.max(1, metadata.height - top - Math.round(metadata.height * crop[3]!));
  const shapeW = Number(ext?.attrs.cx ?? width), shapeH = Number(ext?.attrs.cy ?? height);
  if (!(shapeW > 0 && shapeH > 0)) throw new Error("图片形状尺寸无效");
  const scale = Math.min(1, 1600 / Math.max(shapeW, shapeH));
  const displayW = Math.max(1, Math.round(shapeW * scale)), displayH = Math.max(1, Math.round(shapeH * scale));
  // Separate stages ensure Office's crop -> shape stretch -> flip -> rotation order.
  let visible = await sharp(buffer).extract({ left, top, width, height }).resize(displayW, displayH, { fit: "fill" }).png().toBuffer();
  if (flipH || flipV) visible = await sharp(visible).flop(flipH).flip(flipV).png().toBuffer();
  if (rotation) visible = await sharp(visible).rotate(rotation, { background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
  return { original: buffer.toString("base64"), visible: visible.toString("base64"), originalHash: hash(buffer), visibleHash: hash(visible), source, transform: { crop, rotation, flipH, flipV, width: displayW, height: displayH } };
}
