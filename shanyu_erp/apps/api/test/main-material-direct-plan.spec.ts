import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { DirectMaterialInformation } from "@shanyu/contracts";
import { readDirectMaterialFile, type DirectSource } from "../src/main-material/main-material-direct-file";
import { directCategories, makeDirectPlan, materialIdentity, money } from "../src/main-material/main-material-direct-plan";
import type { MainMaterialCatalog, MainMaterialItem } from "../src/main-material/main-material.repository";

let source: DirectSource, catalog: MainMaterialCatalog;
beforeAll(async () => {
  source = await readDirectMaterialFile(await readFile(resolve(process.cwd(), "assets/main-materials/import-reference.xlsx")));
  const baseline = JSON.parse(await readFile(resolve(process.cwd(), "assets/main-materials/v1/catalog-0919.json"),"utf8"));
  const artPaint = JSON.parse(await readFile(resolve(process.cwd(), "assets/main-materials/v1/catalog-0929-art-paint.json"),"utf8"));
  catalog = { id: "baseline", versionNumber: 7, name: "基线", publishedAt: new Date(0), items: [...baseline.items, ...artPaint.items].map((item: MainMaterialItem) => ({ ...item, id: item.materialId, catalogVersionId: "baseline" })) };
});
function confirmed(): DirectMaterialInformation { return { categoryCode: "TILE", unit: "M²", ambiguousPriceMeaning: "costPrice", rows: Object.fromEntries(source.sheets[0]!.rows.map(row => [row.row,{ itemName: "瓷砖" }])) }; }
function clone() { return structuredClone(source); }
function existing(input = source): MainMaterialCatalog {
  const plan = makeDirectPlan(input, confirmed(), catalog);
  return { ...catalog, items: [...catalog.items, ...plan.changes.map(change => ({ ...change.item, id: change.item.materialId, catalogVersionId: catalog.id, assetIds: change.assetIds }))] };
}
describe("direct material identities and preview protection", () => {
  it("does not infer price meaning, name or unit, and derives five 德祥 suggestions", () => {
    const plan = makeDirectPlan(source,{ categoryCode:"TILE" },catalog);
    expect(plan.counts.unresolved).toBe(15); expect(plan.needsInformation).toBe(true);
    expect(plan.rows.filter(row => row.values.brand==="德祥筑家").every(row => row.suggestedName==="瓷砖" && !row.itemName)).toBe(true);
    expect(plan.nameOptions.TILE).toContain("古堡砖");
  });
  it("confirms all fifteen independently, stable IDs and read destination equality", () => {
    const one = makeDirectPlan(source,confirmed(),catalog), two = makeDirectPlan(clone(),confirmed(),catalog);
    expect(one.counts).toMatchObject({ read:15, added:15, updated:0, unresolved:0 });
    expect(one.changes.map(c => c.item.materialId)).toEqual(two.changes.map(c => c.item.materialId));
    expect(one.changes[0]!.item).toMatchObject({ salePrice:"108.00",costPrice:"65.00",series:"标配",attributes:{process:"糖果釉"} });
  });
  it("skips exact copies independently of filename/source row and price formatting", () => {
    const changed = clone(); changed.fileHash="renamed"; changed.sheets[0]!.rows.forEach(row => { row.values.salePrice += ".00"; });
    expect(makeDirectPlan(changed,confirmed(),existing()).counts.skipped).toBe(15);
  });
  it("updates same identity price and process, keeps blank old values and versions", () => {
    const changed = clone(); changed.sheets[0]!.rows[0]!.values.salePrice="109"; changed.sheets[0]!.rows[0]!.values.process="新工艺"; changed.sheets[0]!.rows[0]!.values.ambiguousPrice="";
    const plan = makeDirectPlan(changed,confirmed(),existing());
    expect(plan.counts).toMatchObject({ added:0,updated:1,skipped:14 });
    expect(plan.changes[0]!.item).toMatchObject({ costPrice:"65.00",salePrice:"109.00",recordVersion:2,attributes:{process:"新工艺"} });
    expect(plan.changes[0]!.expectedRecordVersion).toBe(1);
  });
  it("keeps color cards and cabinet grouping on a plain update", () => {
    const old = existing(), item = { ...old.items.at(-1)!, attributes: { variantGroup:"柜组",variantColor:"颜色",colorAssetMap:'{"色":"card"}' },assetIds:[source.sheets[0]!.rows.at(-1)!.images[0]!.visibleHash,"card"] };
    const modified = { ...old, items:[...old.items.slice(0,-1),item] }, file = clone(); file.sheets[0]!.rows.at(-1)!.values.salePrice="151";
    const change = makeDirectPlan(file,confirmed(),modified).changes[0]!;
    expect(change.assetIds).toContain("card"); expect(change.item.attributes.variantGroup).toBe("柜组");
  });
  it("compares image content instead of interchangeable asset IDs", () => {
    const old = existing(); const first = old.items.find(item => item.model === "V1260301X")!;
    const next = { ...old, items:old.items.map(item => item===first ? {...item,assetIds:["different-id"]} : item) };
    expect(makeDirectPlan(source,confirmed(),next,[],{assetHashes:{"different-id":source.sheets[0]!.rows[0]!.images[0]!.visibleHash}}).counts.skipped).toBe(15);
  });
  it("does not automatically restore inactive products", () => {
    const old = existing(), next = { ...old,items:old.items.map(item => item.model === "V1260301X" ? {...item,status:"INACTIVE" as const} : item) }, file=clone(); file.sheets[0]!.rows[0]!.values.salePrice="109";
    expect(makeDirectPlan(file,confirmed(),next).changes[0]!.item.status).toBe("INACTIVE");
  });
  it("protects removed historical identities", () => {
    const old = existing().items.filter(item => item.model === "V1260301X");
    expect(makeDirectPlan(source,confirmed(),catalog,old).rows[0]!.issues.join()).toContain("已移除");
  });
  it("blocks partial comparison until explicit skip", () => {
    const file=clone(); file.sheets[0]!.rows[0]!.values={brand:"冠珠",model:"V1260301X",spec:"600*1200"}; file.sheets[0]!.rows[0]!.images=[];
    expect(makeDirectPlan(file,confirmed(),existing()).rows[0]!.result).toBe("UNRESOLVED");
    const info=confirmed(); info.rows![3]!.decision="SKIP";
    expect(makeDirectPlan(file,info,existing()).rows[0]!.result).toBe("SKIP");
  });
  it("blocks illegal source names, empty categories and changed category names", () => {
    const info=confirmed(); info.rows![3]!.itemName="任意新名称";
    expect(makeDirectPlan(source,info,catalog).rows[0]!.result).toBe("UNRESOLVED");
    info.rows![3]!.categoryCode="CUSTOM";
    expect(makeDirectPlan(source,info,catalog).rows[0]!.result).toBe("UNRESOLVED");
  });
  it("allows initial empty catalog only with existing configured names", () => {
    expect(makeDirectPlan(source,confirmed(),null).counts.unresolved).toBe(15);
    expect(makeDirectPlan(source,confirmed(),null,[],{configuredNames:{TILE:["瓷砖"]}}).counts.added).toBe(15);
  });
  it("deduplicates identical input, blocks differing duplicate groups until exclusion", () => {
    const file=clone(); file.sheets[0]!.rows.push({...structuredClone(file.sheets[0]!.rows[0]!),row:18});
    const info=confirmed(); info.rows![18]={itemName:"瓷砖"};
    expect(makeDirectPlan(file,info,catalog).counts).toMatchObject({added:15,skipped:1,read:16});
    file.sheets[0]!.rows.at(-1)!.values.salePrice="999";
    expect(makeDirectPlan(file,info,catalog).counts.unresolved).toBe(2);
    info.rows![18]!.decision="EXCLUDE";
    expect(makeDirectPlan(file,info,catalog).counts).toMatchObject({added:15,excluded:1,unresolved:0});
  });
  it("blocks multiple matches, approximate models and ID identity contradictions", () => {
    const old=existing(), item=old.items.find(item => item.model==="V1260301X")!;
    expect(makeDirectPlan(source,confirmed(),{...old,items:[...old.items,{...item,materialId:"another"}]}).counts.unresolved).toBe(1);
    const file=clone(); file.sheets[0]!.rows[0]!.values.materialId=old.items[0]!.materialId;
    expect(makeDirectPlan(file,confirmed(),old).rows[0]!.issues.join()).toContain("矛盾");
    delete file.sheets[0]!.rows[0]!.values.materialId; file.sheets[0]!.rows[0]!.values.model="V126-0301X";
    expect(makeDirectPlan(file,confirmed(),old).rows[0]!.result).toBe("UNRESOLVED");
  });
  it("treats zero as a valid amount and clears only nullable business fields", () => {
    const file=clone(); file.sheets[0]!.rows[0]!.values.salePrice="0"; file.sheets[0]!.rows[0]!.values.remarks="[CLEAR]";
    expect(makeDirectPlan(file,confirmed(),existing()).changes[0]!.item.salePrice).toBe("0.00");
    file.sheets[0]!.rows[0]!.values.salePrice="[CLEAR]";
    expect(makeDirectPlan(file,confirmed(),existing()).changes[0]!.item.status).toBe("PENDING_DATA");
    file.sheets[0]!.rows[0]!.values.model="[CLEAR]";
    expect(makeDirectPlan(file,confirmed(),existing()).rows[0]!.result).toBe("UNRESOLVED");
  });
  it.each(Object.keys(directCategories))("supports existing category %s without assuming tile rules", code => {
    const sample = catalog.items.find(item => item.categoryCode === code)!;
    const input=clone(); input.sheets[0]!.rows=[{row:3,cells:{},images:[],issues:[],values:{categoryCode:code,itemName:sample.itemName,brand:sample.brand,model:sample.model,spec:sample.spec,colors:sample.colors.join("；"),unit:sample.unit,salePrice:sample.salePrice ?? "",costPrice:sample.costPrice ?? "",remarks:sample.remarks}}];
    expect(makeDirectPlan(input,{},catalog).rows[0]!.differences).toEqual([]);
    expect(makeDirectPlan(input,{},catalog).rows[0]!.result).toBe("SKIP");
  });
  it("normalizes format only, never merges different SKU colors or size directions", () => {
    const first={categoryCode:"TILE",brand:"B",model:"001-1",itemName:"瓷砖",spec:"600×1200mm",colors:["黑","白"]};
    expect(materialIdentity(first)).toBe(materialIdentity({...first,spec:"600*1200",colors:["白","黑"]}));
    expect(materialIdentity(first)).not.toBe(materialIdentity({...first,model:"0011"}));
    expect(materialIdentity(first)).not.toBe(materialIdentity({...first,spec:"1200*600"}));
    const colored=clone();colored.sheets[0]!.rows[0]!.values.colors="黑";
    const plan=makeDirectPlan(colored,confirmed(),existing());expect(plan.rows[0]!.result).toBe("NEW");
    expect(plan.changes[0]!.item.colors).toEqual(["黑"]);
  });
  it("keeps precision with decimal strings and rejects non-numeric amounts", () => { expect(money("9999999999999999.99")).toBe("9999999999999999.99"); expect(() => money("每片30")).toThrow(); expect(() => money("1.001")).toThrow(); });
});
