// Local review candidate only: no database, migration, publication or old-file writes.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import JSZip from "../apps/api/node_modules/jszip/lib/index.js";
import { parseMainMaterialWorkbook } from "../apps/api/dist/main-material/main-material-workbook.js";
import { mapFullImportItem } from "../apps/api/dist/main-material/main-material-import-mapping.js";

const require = createRequire(resolve("apps/api/package.json"));
const { SaxesParser } = require("saxes");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [masterPath, langePath, destination] = process.argv.slice(2);
if (!masterPath || !langePath || !destination) throw new Error("用法：在应用目录运行 <总表.xlsx> <朗格.xlsx> <全新候选目录>");
const master = await readFile(masterPath), lange = await readFile(langePath);
const baselinePath = resolve("apps/api/assets/main-materials/v1/catalog-0919.json");
const baselineBytes = await readFile(baselinePath);
const baseline = JSON.parse(baselineBytes);
const parsed = await parseMainMaterialWorkbook(master, "FULL");
if (parsed.validation.blockerCount) throw new Error(parsed.validation.blockers.join("\n"));
const before = new Map(baseline.items.map((item) => [item.materialId, item]));
const items = parsed.payload.map((source) => {
  const old = before.get(source.materialId);
  const { selectionOptions, ...item } = mapFullImportItem(source, old);
  void selectionOptions;
  return { ...item, imageReference: item.attributes.imageReference, assetIds: [...(old?.assetIds ?? [])] };
});
const zip = await JSZip.loadAsync(lange, { checkCRC32: true });
const xml = async (path) => {
  if (!zip.file(path)) throw new Error(`缺少 OOXML 部件：${path}`);
  return zip.file(path).async("string");
};
const attr = (tag, key) => Object.values(tag.attributes).find((a) => a.local === key)?.value;
function parse(value, open, text = () => {}, close = () => {}) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw new Error("不允许 DTD"); });
  parser.on("opentag", open); parser.on("text", text); parser.on("closetag", close);
  parser.write(value).close();
}
async function relations(part) {
  const result = new Map();
  parse(await xml(posix.join(posix.dirname(part), "_rels", `${posix.basename(part)}.rels`)), (tag) => {
    if (tag.local !== "Relationship" || attr(tag, "TargetMode") === "External") return;
    const target = attr(tag, "Target");
    const path = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join(posix.dirname(part), target));
    if (!path.startsWith("xl/")) throw new Error("资源路径越界");
    result.set(attr(tag, "Id"), path);
  });
  return result;
}
const workbookRelations = await relations("xl/workbook.xml");
let sheet;
parse(await xml("xl/workbook.xml"), (tag) => {
  if (tag.local === "sheet" && attr(tag, "name") === "产品图索引") sheet = workbookRelations.get(attr(tag, "id"));
});
if (!sheet) throw new Error("未找到产品图索引");
const sheetRelations = await relations(sheet);
let drawing;
parse(await xml(sheet), (tag) => { if (tag.local === "drawing") drawing = sheetRelations.get(attr(tag, "id")); });
if (!drawing) throw new Error("产品图索引没有绘图");
const imageRelations = await relations(drawing);
const anchors = [];
let current, inFrom = false, reading;
parse(await xml(drawing), (tag) => {
  if (["oneCellAnchor", "twoCellAnchor"].includes(tag.local)) current = {};
  if (tag.local === "from") inFrom = true;
  if (inFrom && ["row", "col", "rowOff", "colOff"].includes(tag.local)) reading = tag.local;
  if (tag.local === "blip" && current) current.path = imageRelations.get(attr(tag, "embed"));
}, (value) => { if (reading && current) current[reading] = Number(value); }, (tag) => {
  if (tag.local === reading) reading = undefined;
  if (tag.local === "from") inFrom = false;
  if (["oneCellAnchor", "twoCellAnchor"].includes(tag.local)) { anchors.push(current); current = undefined; }
});
const matches = anchors.filter((anchor) => anchor.col === 6 && anchor.row === 9 && anchor.rowOff === 0);
if (matches.length !== 1 || !matches[0].path) throw new Error("G10 必须精确对应一张主图，禁止按旧行偏移猜测");
const picture = await zip.file(matches[0].path).async("nodebuffer");
if (picture.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("G10 图片不是 PNG");
const asset = { id: hash(picture), fileName: `${hash(picture)}.png`, contentType: "image/png", size: picture.length };
const shower = items.find((item) => item.materialId === "MAT-SHOWER-DC6F85FFDF14");
if (!shower || !isDeepStrictEqual(shower.attributes.type.split(/[；;]/), ["钻石型", "T型", "一固一开"])) throw new Error("34A 类型与已确认总表不符");
const previousImage = shower.assetIds[0];
shower.assetIds = [asset.id, ...shower.assetIds.slice(1)];
shower.attributes.showerTypes = JSON.stringify(["钻石型", "T型", "一固一开"]);
const used = new Set(items.flatMap((item) => item.assetIds));
const assets = [...baseline.assets.filter((item) => used.has(item.id)), asset];
const assetBytes = new Map();
for (const item of assets) {
  const bytes = item.id === asset.id ? picture : await readFile(resolve(dirname(baselinePath), "images", item.fileName));
  if (hash(bytes) !== item.id || bytes.length !== item.size) throw new Error(`资产校验失败：${item.id}`);
  assetBytes.set(item.fileName, bytes);
}
for (const item of items) for (const key of ["colorAssetMap", "glassColorAssetMap"]) {
  for (const id of Object.values(JSON.parse(item.attributes[key] || "{}"))) {
    if (!item.assetIds.includes(id) || !assets.some((asset) => asset.id === id)) throw new Error(`${item.materialId} 选色资产缺失`);
  }
}
const changes = items.flatMap((item) => {
  const old = before.get(item.materialId);
  const differences = Object.keys(item).filter((key) => key !== "recordVersion" && !isDeepStrictEqual(item[key], old?.[key]))
    .map((field) => ({ field, before: old?.[field], after: item[field] }));
  return differences.length ? [{ materialId: item.materialId, recordVersionBefore: old?.recordVersion, recordVersionAfter: item.recordVersion, differences }] : [];
});
const summary = { itemCount: items.length, activeCount: items.filter((i) => i.status === "ACTIVE").length,
  pendingCount: items.filter((i) => i.status === "PENDING_DATA").length, inactiveCount: items.filter((i) => i.status === "INACTIVE").length,
  assetCount: assets.length, referencedImageItemCount: items.filter((i) => i.assetIds.length).length };
const report = { status: "CANDIDATE_NOT_PUBLISHED", baselineHash: hash(baselineBytes), masterHash: hash(master), langeHash: hash(lange),
  summary, changedItems: changes.length, changes,
  image34A: { source: "产品图索引!G10", anchor: matches[0], previousImage, asset,
    width: picture.readUInt32BE(16), height: picture.readUInt32BE(20), unmodifiedEmbeddedBytes: true },
  assetsVerified: assets.length, warnings: parsed.validation.warnings,
  publicationBlockers: ["候选未发布；发布前须对实际当前库进行受控差异预览与授权", "34A类型选型及快照接口须验收通过后发布"] };
await mkdir(resolve(destination)); // Refuse to replace an existing candidate directory.
await mkdir(resolve(destination, "images"));
await writeFile(resolve(destination, "catalog-0920-candidate.json"), JSON.stringify({ ...baseline,
  version: { name: "山屿 ERP 主材库 0920 验收候选", sourceFile: "山屿ERP主材库_v1.xlsx", sourceHash: hash(master) }, summary, items, assets }, null, 2) + "\n", { flag: "wx" });
await writeFile(resolve(destination, "per-id-and-assets-report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
for (const [name, bytes] of assetBytes) await writeFile(resolve(destination, "images", name), bytes, { flag: "wx" });
console.log(JSON.stringify({ destination: resolve(destination), ...summary, changedItems: changes.length, image34A: report.image34A }));
