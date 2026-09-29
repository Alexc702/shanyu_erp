import type { DirectMaterialInformation, DirectMaterialRowView, MainMaterialCategoryCode } from "@shanyu/contracts";
import { hash, type DirectSource, type DirectSourceRow } from "./main-material-direct-file";
import type { MainMaterialCatalog, MainMaterialItem, NormalizedMainMaterialItem } from "./main-material.repository";

export const directCategories: Record<MainMaterialCategoryCode, string> = {
  ART_PAINT: "艺术漆",
  TILE: "瓷砖", SEAM: "美缝", FLOOR: "木地板", GLASS_DOOR: "房门 / 玻璃门", CEILING: "集成吊顶", BATHROOM: "卫浴", SHOWER: "淋浴房", STONE: "石材 / 岩板", SWITCH: "开关面板", CUSTOM: "定制类",
};
export interface DirectChange { item: NormalizedMainMaterialItem; expectedRecordVersion: number; assetIds: string[] }
export interface DirectPlan {
  rows: DirectMaterialRowView[]; changes: DirectChange[]; needsInformation: boolean;
  nameOptions: Partial<Record<MainMaterialCategoryCode, string[]>>;
  selectedSheet: string | null; ambiguousPriceLabel: string | null;
  counts: { read: number; added: number; updated: number; skipped: number; excluded: number; unresolved: number; pending: number; warnings: number };
}
const text = (s: string) => s.normalize("NFKC").trim();
export function normalizedSpec(s: string): string {
  return text(s).toLowerCase().replace(/\s/g, "").replace(/[×x]/g, "*").replace(/毫米|mm/g, "");
}
const colors = (s: string) => s.split(/[;；]/).map(value => value.trim()).filter(Boolean).sort();
export function materialIdentity(i: { categoryCode: string; brand: string; model: string; itemName: string; spec: string; colors: readonly string[] }): string {
  return JSON.stringify([i.categoryCode, text(i.brand), text(i.model || i.itemName), normalizedSpec(i.spec), [...i.colors].map(text).sort()]);
}
export function directNameOptions(items: readonly MainMaterialItem[]) {
  return Object.fromEntries(Object.keys(directCategories).map(code => [code, [...new Set(items.filter(i => i.categoryCode === code).map(i => i.itemName).filter(Boolean))].sort()])) as Record<MainMaterialCategoryCode, string[]>;
}
export function category(value: string | undefined): MainMaterialCategoryCode | null {
  if (!value) return null;
  if (value in directCategories) return value as MainMaterialCategoryCode;
  const aliases: Record<string, MainMaterialCategoryCode> = { "玻璃门": "GLASS_DOOR", "房门|门套 - 玻璃门": "GLASS_DOOR", "石材|岩板": "STONE", "石材/岩板": "STONE" };
  return aliases[value] ?? (Object.entries(directCategories).find(([, name]) => name === value)?.[0] as MainMaterialCategoryCode | undefined) ?? null;
}
export function money(value: string): string {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) throw new Error("价格须为非负人民币数值，最多两位小数；不能填写公式错误或混合单位");
  const [whole, fraction = ""] = value.split(".");
  return `${BigInt(whole!)}.${fraction.padEnd(2, "0")}`;
}
function normalizeValue(value: string): string { return value === "[CLEAR]" ? "" : value.trim(); }
function pictureIds(item: MainMaterialItem): string[] {
  const cards = new Set<string>();
  for (const key of ["colorAssetMap", "glassColorAssetMap"]) {
    try { Object.values(JSON.parse(item.attributes[key] || "{}")).forEach(v => { if (typeof v === "string") cards.add(v); }); } catch { /* Existing validation reports malformed mappings. */ }
  }
  return item.assetIds.filter(id => !cards.has(id));
}
function business(item: NormalizedMainMaterialItem) {
  const amount = (value: string | null) => value === null ? "" : money(value);
  return { itemName: item.itemName, brand: item.brand, series: item.series, process: item.attributes.process ?? "", model: item.model, spec: normalizedSpec(item.spec), colors: [...item.colors].sort().join("；"), unit: item.unit, costPrice: amount(item.costPrice), salePrice: amount(item.salePrice), remarks: item.remarks, status: item.status };
}
export function makeDirectPlan(source: DirectSource, information: DirectMaterialInformation, catalog: MainMaterialCatalog | null, historical: readonly MainMaterialItem[] = [], options: { configuredNames?: Partial<Record<MainMaterialCategoryCode, string[]>>; assetHashes?: Record<string,string> } = {}): DirectPlan {
  const current = catalog?.items ?? [], nameOptions = catalog ? directNameOptions(current) : options.configuredNames ?? directNameOptions([]);
  const selectedSheet = information.sheet ?? (source.sheets.length === 1 ? source.sheets[0]!.name : null);
  const sheet = source.sheets.find(s => s.name === selectedSheet);
  const plan: DirectPlan = { rows: [], changes: [], needsInformation: !sheet, nameOptions, selectedSheet, ambiguousPriceLabel: sheet?.headers.ambiguousPrice ?? null,
    counts: { read: sheet?.rows.length ?? 0, added: 0, updated: 0, skipped: 0, excluded: 0, unresolved: 0, pending: 0, warnings: 0 } };
  if (!sheet) return plan;
  const candidates: { view: DirectMaterialRowView; change: DirectChange | null; identity: string; signature: string }[] = [];
  for (const raw of sheet.rows) {
    const choice = information.rows?.[String(raw.row)] ?? {};
    const values = { ...raw.values, ...choice.values };
    const code = category(choice.categoryCode ?? values.categoryCode ?? information.categoryCode);
    const issues = [...raw.issues], warnings: string[] = [];
    const name = choice.itemName ?? values.itemName ?? "";
    const unit = choice.unit ?? values.unit ?? information.unit ?? "";
    if (!code) issues.push("主材分类待确认");
    if (!unit) issues.push("计价单位待确认");
    if (values.ambiguousPrice && !information.ambiguousPriceMeaning) issues.push(`${sheet.headers.ambiguousPrice}含义待确认`);
    if (choice.values) {
      for (const key of Object.keys(choice.values)) if (!["brand", "model", "spec", "colors", "costPrice", "salePrice", "remarks", "series", "process"].includes(key)) issues.push("补充字段不允许修改系统身份或状态");
    }
    const identityInput = { categoryCode: code ?? "", brand: values.brand ?? "", model: values.model ?? "", itemName: name, spec: values.spec ?? "", colors: colors(values.colors ?? "") };
    const key = materialIdentity(identityInput);
    let matches = current.filter(i => materialIdentity(i) === key);
    if (values.materialId) {
      const byId = current.filter(i => i.materialId === values.materialId);
      if (byId.length && materialIdentity(byId[0]!) !== key) issues.push("material_id与自然身份矛盾");
      matches = byId;
    }
    const old = matches.length === 1 ? matches[0] : undefined;
    const related = code ? current.filter(i => i.categoryCode === code && i.brand === values.brand
      && (values.series || values.process) && (!values.series || i.series === values.series)
      && (!values.process || !i.attributes.process || i.attributes.process === values.process)) : [];
    const suggested = old?.itemName ?? (new Set(related.map(i => i.itemName)).size === 1 ? related[0]?.itemName : null);
    if (!name || !code || !nameOptions[code]?.includes(name)) issues.push("品名须确认并选择所属分类已有选项");
    if (!old && (!identityInput.model && !name || code === "TILE" && (!identityInput.brand || !identityInput.spec))) issues.push("商品身份不足，请补齐品牌、型号/品名与规格");
    if (matches.length > 1) issues.push("同身份存在多条已有商品，不能自动覆盖");
    const removed = historical.filter(i => materialIdentity(i) === key && !current.some(c => c.materialId === i.materialId));
    if (removed.length || values.materialId && !old && historical.some(i => i.materialId === values.materialId)) issues.push("匹配已移除历史身份，不能以新ID重建");
    const nearby = !matches.length ? current.filter(i => i.categoryCode === code && text(i.brand) === text(identityInput.brand)
      && i.model && identityInput.model && normalizedSpec(i.spec) === normalizedSpec(identityInput.spec)
      && JSON.stringify([...i.colors].map(text).sort()) === JSON.stringify([...identityInput.colors].map(text).sort())
      && i.model.normalize("NFKC").replace(/[-_\s]/g, "").toLowerCase() === identityInput.model.normalize("NFKC").replace(/[-_\s]/g, "").toLowerCase()) : [];
    if (nearby.length) issues.push("型号近似但内部字符不同，请核实身份或跳过/排除");
    const item = { ...proposedItem(raw, values, code, name, unit, information, old, source.fileHash, issues), sourceSheet: sheet.name };
    if (old && !["costPrice", "salePrice", "remarks", "process", "series", "colors"].some(field => values[field]) && !values.ambiguousPrice && !raw.images.length) issues.push("比较资料不足，不能证明完全一致，请补齐资料或人工确认跳过");
    if (old && values.colors && (old.attributes.colorAssetMap || old.attributes.variantGroup || old.attributes.glassColors)
      && JSON.stringify(colors(values.colors)) !== JSON.stringify([...old.colors].sort())) issues.push("颜色或分组关系变更无法由普通商品资料确定，请保留原关系或排除");
    if (!old && values.colors && ((code === "GLASS_DOOR") || values.brand === "顾朗" || /浴室柜/.test(name))) issues.push("颜色归属及分组选项资料不足，不能臆造关联");
    if (!old && /核心主材|板材/.test(values.remarks ?? "") && /浴室柜/.test(name)) issues.push("核心板材资料不能作为整柜价格导入");
    const previousPictureIds = old ? pictureIds(old) : [];
    const newPictureIds = raw.images.map(i => i.visibleHash);
    const assetIds = raw.images.length ? [...new Set([...newPictureIds, ...(old?.assetIds.filter(id => !previousPictureIds.includes(id)) ?? [])])] : [...old?.assetIds ?? []];
    if (!assetIds.length) warnings.push("缺少产品图");
    if (item.status === "PENDING_DATA") warnings.push(`待补资料：${item.missingFields}`);
    const previous = old ? business(old) : {}, next = business(item);
    const differences = Object.entries(next).filter(([field, value]) => (previous as Record<string, string>)[field] !== value).map(([field, after]) => ({ field, before: (previous as Record<string, string>)[field] ?? "—", after: after || "—" }));
    if (raw.images.length && JSON.stringify(previousPictureIds.map(id => options.assetHashes?.[id] ?? id)) !== JSON.stringify(newPictureIds)) differences.push({ field: "产品图", before: previousPictureIds.join("、") || "无产品图", after: newPictureIds.join("、") });
    let result: DirectMaterialRowView["result"] = issues.length ? "UNRESOLVED" : old ? differences.length ? "UPDATE" : "SKIP" : "NEW";
    let reason = result === "SKIP" ? "身份及本次提供业务内容与已有商品一致" : result === "UPDATE" ? "自然身份唯一匹配，业务内容变化" : "无精确或疑似匹配";
    if (choice.decision === "EXCLUDE") { result = "EXCLUDE"; reason = "人工排除，本次不发布"; }
    else if (choice.decision === "SKIP") {
      if (matches.length || nearby.length || removed.length) { result = "SKIP"; reason = "人工确认跳过，不改已有商品"; }
      else { issues.push("无法定位已有商品，不能用跳过隐藏未知身份"); result = "UNRESOLVED"; }
    }
    const view: DirectMaterialRowView = { row: raw.row, values: { ...values, unit, itemName: name }, categoryCode: code, itemName: name,
      suggestedName: suggested ?? null, suggestionReason: old ? "已有商品身份唯一匹配" : suggested ? "同分类、品牌及系列/工艺的已有商品品名一致，待确认" : "暂无可靠建议，请从已有品名选择",
      nameOptions: code ? nameOptions[code] ?? [] : [], result, reason, issues, warnings, pending: item.status === "PENDING_DATA", materialId: old?.materialId ?? (result === "NEW" ? item.materialId : null),
      expectedRecordVersion: old?.recordVersion ?? 0, candidates: [...matches, ...nearby, ...removed].map(i => ({ materialId: i.materialId, model: i.model, status: i.status })), duplicateRows: [], differences,
      images: raw.images.map(image => ({ originalHash: image.originalHash, visibleHash: image.visibleHash, transform: image.transform, url: `data:image/png;base64,${image.visible}` })), oldImageUrls: previousPictureIds.map(id => `/catalog/main-materials/assets/${id}`) };
    const needs = !code || !unit || !name || !nameOptions[code]?.includes(name) || values.ambiguousPrice && !information.ambiguousPriceMeaning;
    if (needs && result !== "EXCLUDE" && result !== "SKIP") plan.needsInformation = true;
    candidates.push({ view, identity: key, signature: JSON.stringify({ ...next, images: newPictureIds }), change: { item, expectedRecordVersion: old?.recordVersion ?? 0, assetIds } });
  }
  const groups = new Map<string, typeof candidates>();
  for (const row of candidates.filter(c => c.view.result !== "EXCLUDE")) groups.set(row.identity, [...groups.get(row.identity) ?? [], row]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (new Set(group.map(c => c.signature)).size > 1) {
      for (const row of group) { row.view = { ...row.view, duplicateRows:group.map(c=>c.view.row), result: "UNRESOLVED", reason: "文件内同身份内容不同", issues: [...row.view.issues, `差异重复组：第${group.map(c => c.view.row).join("、")}行，请保留一条或排除整组`] }; }
    } else for (const duplicate of group.slice(1)) duplicate.view = { ...duplicate.view, result: "SKIP", reason: `文件内完全重复，保留第${group[0]!.view.row}行` };
  }
  plan.rows = candidates.map(c => c.view);
  plan.changes = candidates.filter(c => ["NEW", "UPDATE"].includes(c.view.result)).map(c => c.change!);
  const counter = { NEW: "added", UPDATE: "updated", SKIP: "skipped", EXCLUDE: "excluded", UNRESOLVED: "unresolved" } as const;
  for (const row of plan.rows) { plan.counts[counter[row.result]]++; if (row.pending) plan.counts.pending++; if (row.warnings.length) plan.counts.warnings++; }
  return plan;
}
function proposedItem(raw: DirectSourceRow, values: Record<string, string>, code: MainMaterialCategoryCode | null, name: string, unit: string, information: DirectMaterialInformation, old: MainMaterialItem | undefined, fileHash: string, issues: string[]): NormalizedMainMaterialItem {
  const get = (field: string, previous = "") => values[field] ? normalizeValue(values[field]!) : previous;
  for (const field of ["brand", "model", "spec"]) if (values[field] === "[CLEAR]") issues.push(`身份字段 ${field} 不允许清空`);
  const price = (field: "costPrice" | "salePrice") => {
    const supplied = values[field] || (information.ambiguousPriceMeaning === field ? values.ambiguousPrice : "");
    if (!supplied) return old?.[field] ?? null;
    if (supplied === "[CLEAR]") return null;
    try { return money(supplied); } catch (error) { issues.push(`${raw.cells[field] ?? raw.cells.ambiguousPrice ?? `第${raw.row}行`}：${error instanceof Error ? error.message : "价格无效"}`); return null; }
  };
  const attributes = { ...old?.attributes };
  if (values.process) attributes.process = normalizeValue(values.process);
  const item: NormalizedMainMaterialItem = { attributes, brand: get("brand", old?.brand), categoryCode: code ?? "TILE", categoryName: code ? directCategories[code] : "", colors: values.colors ? colors(normalizeValue(values.colors)) : old?.colors ?? [],
    costPrice: price("costPrice"), salePrice: price("salePrice"), itemName: name, model: get("model", old?.model), spec: get("spec", old?.spec), unit: unit || old?.unit || "",
    materialId: old?.materialId ?? `MAT-${code ?? "UNKNOWN"}-${hash(materialIdentity({ categoryCode: code ?? "", brand: values.brand ?? "", model: values.model ?? "", itemName: name, spec: values.spec ?? "", colors: colors(values.colors ?? "") })).slice(0, 24).toUpperCase()}`,
    recordVersion: (old?.recordVersion ?? 0) + 1, status: old?.status ?? "ACTIVE", missingFields: "", remarks: get("remarks", old?.remarks), series: get("series", old?.series),
    sourceFile: fileHash, sourceSheet: old?.sourceSheet ?? "", sourceRow: String(raw.row), priceDerivation: old?.priceDerivation };
  const missing = [!item.model && !item.itemName ? "型号/品名" : "", !item.unit ? "单位" : "", item.costPrice === null ? "成本" : "", item.salePrice === null ? "售价" : "", code === "TILE" && !item.brand ? "品牌" : "", code === "TILE" && !item.spec ? "规格" : ""].filter(Boolean);
  return { ...item, missingFields: missing.join("；"), status: old?.status === "INACTIVE" ? "INACTIVE" : missing.length ? "PENDING_DATA" : "ACTIVE" };
}
