// Build a reviewed immutable release input; never connects to a database or publishes.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "../apps/api/node_modules/jszip/lib/index.js";
import { parseMainMaterialWorkbook } from "../apps/api/dist/main-material/main-material-workbook.js";
import { mapFullImportItem } from "../apps/api/dist/main-material/main-material-import-mapping.js";

const [input, output, fixtureOutput = "apps/api/test/fixtures/main-material-0919.xlsx"] = process.argv.slice(2);
if (!input || !output) throw new Error("用法：先构建 API，再运行 prepare-main-material-baseline.mjs <源.xlsx> <新快照.json>；输出必须是新文件");
const buffer = await readFile(resolve(input));
const previous = JSON.parse(await readFile(resolve("apps/api/assets/main-materials/v1/catalog.json"), "utf8"));
const parsed = await parseMainMaterialWorkbook(buffer, "FULL");
if (parsed.validation.blockerCount) throw new Error(parsed.validation.blockers.join("\n"));
const byId = new Map(previous.items.map((item) => [item.materialId, item]));
const items = parsed.payload.map((raw) => {
  const old = byId.get(raw.materialId);
  const { selectionOptions, ...item } = mapFullImportItem(raw, old);
  void selectionOptions;
  return { ...item, imageReference: item.attributes.imageReference, assetIds: old?.assetIds ?? [] };
});
const used = new Set(items.flatMap((i) => i.assetIds));
const assets = previous.assets.filter((a) => used.has(a.id));
const baseline = {
  ...previous,
  version: { name: "山屿 ERP 主材库 0919 总表统一版", sourceFile: "山屿ERP主材库_v1.xlsx", sourceHash: createHash("sha256").update(buffer).digest("hex") },
  summary: { itemCount: items.length, activeCount: items.filter((i) => i.status === "ACTIVE").length, pendingCount: items.filter((i) => i.status === "PENDING_DATA").length, assetCount: assets.length, referencedImageItemCount: items.filter((i) => i.assetIds.length).length },
  items, assets,
};
await writeFile(resolve(output), JSON.stringify(baseline, null, 2) + "\n", { flag: "wx" });
// Preserve original OOXML business parts (including namespaces) as a compact regression fixture.
const zip = await JSZip.loadAsync(buffer);
const fixture = new JSZip();
for (const path of ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet4.xml", "xl/worksheets/sheet6.xml"]) {
  fixture.file(path, await zip.file(path).async("nodebuffer"));
}
await mkdir("apps/api/test/fixtures", { recursive: true });
await writeFile(fixtureOutput, await fixture.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), { flag: "wx" });
console.log(JSON.stringify(baseline.summary));
