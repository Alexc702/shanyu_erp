import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { DatabaseExecutor } from "../database/database.client";
import { isMainMaterialColorSelectionValid } from "./main-material-selection";

type Row = Record<string, unknown>;
// Sorted object keys, stable arrays and exact decimal strings; never Number(price).
export function safeUpdateHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, item]) => [k, canonical(item)]));
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
interface Difference { field: string; before: unknown; after: unknown }

// Provenance and version IDs may change. All customer/business fields must not.
const businessFields = ["material_id", "category_code", "category_name", "item_name", "brand",
  "series", "model", "spec", "colors", "unit", "sale_price", "cost_price", "attributes",
  "data_status", "missing_fields", "price_derivation", "remarks", "asset_ids"];
const snapshotFields = ["material_id", "category_code", "item_name", "brand", "series", "model", "spec", "unit", "asset_ids"];

function decimal(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,4})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${BigInt(whole!)}.${fraction.padEnd(4, "0")}`;
}

export function selectionImpact(line: Row, previous: Row | undefined, next: Row | undefined): Difference[] {
  const differences: Difference[] = [];
  const compare = (field: string, before: unknown, after: unknown) => {
    if (!isDeepStrictEqual(before, after)) differences.push({ field, before: before ?? null, after: after ?? null });
  };
  if (!previous || !next) return [{ field: "missing_item", before: previous?.id ?? null, after: next?.id ?? null }];
  for (const field of businessFields) compare(field, previous[field], next[field]);
  for (const field of snapshotFields) compare(`snapshot.${field}`, line[field], next[field]);
  for (const kind of ["sale", "cost"]) {
    const price = decimal(next[`${kind}_price`]);
    if (price === null) differences.push({ field: `${kind}_price_missing`, before: line[`${kind}_unit_price`], after: null });
    else compare(`snapshot.${kind}_unit_price`, decimal(line[`${kind}_unit_price`]), price);
  }
  if (next.data_status !== "ACTIVE") differences.push({ field: "unavailable", before: "ACTIVE", after: next.data_status });
  if (!isMainMaterialColorSelectionValid({
    categoryCode: String(next.category_code), colors: next.colors as string[],
    attributes: next.attributes as Record<string, string>,
  }, line.selected_color as string | null)) {
    differences.push({ field: "selected_color_invalid", before: line.selected_color, after: null });
  }
  if (line.origin === "AUTO_TILE") {
    const normalize = (v: unknown) => String(v).toLowerCase().replaceAll("×", "*").replaceAll("x", "*").replaceAll("mm", "").replaceAll(" ", "");
    compare("tile_spec", normalize(line.demand_spec), normalize(next.spec));
    if (!["m2", "m²", "㎡"].includes(String(next.unit).trim().toLowerCase())) {
      differences.push({ field: "tile_unit", before: line.unit, after: next.unit });
    }
  }
  return differences;
}

interface QuoteRow extends Row {
  id: string; project_id: string; version_number: number; revision: number;
  status: string; is_current: boolean; parent_version_id: string | null;
  main_material_catalog_version_id: string | null; has_history: boolean;
}
export interface SafeUpdateEntry {
  projectId: string; projectAddress: string; quotationId: string; version: number; revision: number; status: string;
  fromCatalogId: string | null; outcome: "PROTECTED" | "CURRENT" | "BLOCKED" | "SAFE" | "UPDATED";
  differences: { lineId: string; changes: Difference[] }[];
  reason: string;
}

/** Caller owns the transaction. Apply locks catalog publication and quotations;
 * preview must run in a REPEATABLE READ READ ONLY transaction. Never recalculates. */
export async function reconcileSafeDrafts(database: DatabaseExecutor, options: {
  apply: boolean; actorUserId?: string; targetCatalogId?: string;
  targetCatalogHash?: string; expectedPlanHash?: string;
}) {
  if (options.apply) {
    await database.query("LOCK TABLE main_material_catalog_versions IN SHARE ROW EXCLUSIVE MODE");
    // Also serialize direct maintenance edits, not only publication through the API.
    await database.query("LOCK TABLE main_material_item_versions, main_material_item_assets, half_package_quotations, main_material_quote_lines IN SHARE ROW EXCLUSIVE MODE");
  }
  const target = (await database.query<{ id: string; version_number: number }>(
    "SELECT id, version_number FROM main_material_catalog_versions WHERE status = 'PUBLISHED'",
  )).rows[0];
  if (!target || (options.targetCatalogId && options.targetCatalogId !== target.id)) {
    throw new Error("目标主材库不是当前已发布版本，已停止更新");
  }
  const quotes = (await database.query<QuoteRow>(
    `SELECT q.*, EXISTS (SELECT 1 FROM half_package_quotations h
       WHERE h.project_id = q.project_id AND h.id <> q.id) AS has_history
       FROM half_package_quotations q ORDER BY q.id ${options.apply ? "FOR UPDATE OF q" : ""}`,
  )).rows;
  const items = (await database.query<Row>(
    `SELECT i.*, coalesce((SELECT jsonb_agg(a.asset_id ORDER BY a.sort_order, a.asset_id)
       FROM main_material_item_assets a WHERE a.catalog_version_id = i.catalog_version_id
       AND a.material_id = i.material_id), '[]'::jsonb) AS asset_ids
       FROM main_material_item_versions i`,
  )).rows;
  const previous = new Map(items.map(i => [i.id, i]));
  const latest = new Map(items.filter(i => i.catalog_version_id === target.id).map(i => [i.material_id, i]));
  const targetCatalogHash = safeUpdateHash([...latest.values()]
    .sort((a, b) => String(a.material_id).localeCompare(String(b.material_id), "en"))
    .map(item => Object.fromEntries(businessFields.map(field => [field, item[field]]))));
  if (options.targetCatalogHash && options.targetCatalogHash !== targetCatalogHash) {
    throw new Error("目标主材库内容哈希不符，已停止更新");
  }
  const planInputs: unknown[] = [target.id, targetCatalogHash, quotes];
  const entries: SafeUpdateEntry[] = [];
  for (const q of quotes) {
    const entry: SafeUpdateEntry = { projectId: q.project_id, projectAddress: String(q.project_address), quotationId: q.id, version: q.version_number, status: q.status,
      revision: q.revision, fromCatalogId: q.main_material_catalog_version_id, outcome: "PROTECTED", differences: [], reason: "非当前首次编辑草稿，或存在历史血缘" };
    entries.push(entry);
    // Descendant drafts never become eligible, even on later releases.
    if (!q.is_current || q.status !== "DRAFT" || q.parent_version_id || q.version_number !== 1 || q.has_history) continue;
    if (q.main_material_catalog_version_id === target.id) { entry.outcome = "CURRENT"; entry.reason = "已引用目标库，无需更新"; continue; }
    const lines = (await database.query<Row>(
      `SELECT * FROM main_material_quote_lines WHERE quotation_id = $1 ORDER BY id ${options.apply ? "FOR UPDATE" : ""}`, [q.id],
    )).rows;
    planInputs.push(lines);
    for (const line of lines) {
      if (!line.material_id && !line.item_version_id) continue;
      const old = previous.get(line.item_version_id);
      const changes = selectionImpact(line, old, latest.get(line.material_id));
      if (!old || old.catalog_version_id !== q.main_material_catalog_version_id) {
        changes.push({ field: "source_catalog_mismatch", before: old?.catalog_version_id ?? null, after: q.main_material_catalog_version_id });
      }
      if (changes.length) entry.differences.push({ lineId: String(line.id), changes });
    }
    if (entry.differences.length) { entry.outcome = "BLOCKED"; entry.reason = "存在业务差异，整份报价保留原样"; continue; }
    entry.outcome = "SAFE";
    entry.reason = "逐字段零影响，只允许更新库与商品版本引用及审计元数据";
    if (!options.apply) continue;
    // Only references change; no UPDATE of any snapshot, quantity, price or total.
    await database.query(`UPDATE main_material_quote_lines l SET item_version_id = i.id
      FROM main_material_item_versions i WHERE l.quotation_id = $1
      AND i.catalog_version_id = $2 AND i.material_id = l.material_id`, [q.id, target.id]);
    const updated = await database.query(`UPDATE half_package_quotations
      SET main_material_catalog_version_id = $2, revision = revision + 1, updated_at = current_timestamp
      WHERE id = $1 AND revision = $3 AND status = 'DRAFT' AND is_current`, [q.id, target.id, q.revision]);
    if (updated.rowCount !== 1) throw new Error("报价并发修改，事务已中止");
    await database.query(`INSERT INTO audit_events
      (id, action, actor_user_id, occurred_at, result, target_type, target_id, before_value, after_value, metadata)
      VALUES ($1, 'MAIN_MATERIAL_SAFE_AUTO_UPDATED', $2, current_timestamp, 'SUCCESS', 'HALF_PACKAGE_QUOTATION', $3, $4, $5, $6)`,
    [randomUUID(), options.actorUserId ?? null, q.id,
      { catalogId: q.main_material_catalog_version_id, revision: q.revision },
      { catalogId: target.id, revision: q.revision + 1 }, { policy: "zero-impact-v1", lineCount: lines.length }]);
    entry.outcome = "UPDATED";
  }
  const summary = Object.fromEntries(["PROTECTED", "CURRENT", "BLOCKED", "SAFE", "UPDATED"].map(
    outcome => [outcome, entries.filter(entry => entry.outcome === outcome).length],
  ));
  // All analysis, including outcomes derived from old catalog rows, is bound to the preview.
  const planHash = safeUpdateHash([planInputs, entries.map(e => ({ ...e, outcome: e.outcome === "UPDATED" ? "SAFE" : e.outcome }))]);
  if (options.expectedPlanHash && options.expectedPlanHash !== planHash) {
    throw new Error("预览已过期，整个更新事务必须回滚");
  }
  return { policy: "zero-impact-v1", targetCatalogId: target.id, targetCatalogHash, planHash, targetVersion: target.version_number, summary, entries };
}
