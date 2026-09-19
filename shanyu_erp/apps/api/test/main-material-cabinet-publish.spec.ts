import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { DatabaseClient, DatabaseExecutor } from "../src/database/database.client";
import type { NormalizedMainMaterialItem } from "../src/main-material/main-material.repository";
import { PgMainMaterialRepository } from "../src/main-material/pg-main-material.repository";

describe("cabinet mappings at publication", () => {
  it.each(["FULL", "DELTA"] as const)("preserves mappings and cabinet prices through %s publication", async (mode) => {
    const baseline = JSON.parse(await readFile(
      resolve(process.cwd(), "assets/main-materials/v1/catalog.json"), "utf8",
    )) as { items: (NormalizedMainMaterialItem & { assetIds: string[] })[] };
    const previous = baseline.items.find((item) => item.materialId === "MAT-BATHROOM-DD50EBFFF7E0")!;
    // An older validated FULL batch can still contain raw spreadsheet names.
    const payload = mode === "FULL" ? [{
      ...previous, model: "洞石米白", colors: ["洞石米白"], sourceRow: "97",
      attributes: { imageReference: previous.attributes.imageReference },
    }] : [{
      operation: "UPSERT", materialId: previous.materialId,
      expectedRecordVersion: previous.recordVersion, changeReason: "更新核心主材颜色",
      values: { color: previous.colors[0], remarks: "核对颜色与整柜售价" },
    }];
    let publishedId = "previous-catalog";
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      if (sql.includes("UPDATE main_material_catalog_versions") && sql.includes("SET status = 'PUBLISHED'")) {
        publishedId = values![0] as string;
      }
      if (sql.includes("FROM main_material_import_batches")) return { rows: [{
        id: "batch", mode, status: "VALIDATED", validation_report: { blockerCount: 0 },
        normalized_payload: payload, file_name: "主材库.xlsx", file_hash: "hash",
      }] };
      if (sql.includes("max(version_number)")) return { rows: [{ next_version: 7 }] };
      if (sql.includes("FROM main_material_catalog_versions")) return { rows: [{
        id: publishedId, version_number: 6, name: "已发布主材库", published_at: new Date(0),
      }] };
      if (sql.includes("FROM main_material_item_versions i")) return { rows: [toDatabaseRow(previous)] };
      // Keep parameter capture typed even for write statements.
      void values;
      return { rows: [] };
    });
    const database = {
      query,
      transaction: async <Result>(work: (executor: DatabaseExecutor) => Promise<Result>) =>
        work({ query } as unknown as DatabaseExecutor),
    } as unknown as DatabaseClient;
    const repository = new PgMainMaterialRepository(database);
    vi.spyOn(repository, "getCatalogById").mockResolvedValue({
      id: "new-catalog", items: [], name: "新版", publishedAt: new Date(0), versionNumber: 7,
    });

    await repository.publishImportBatch("batch", "owner");
    const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO main_material_item_versions"));
    expect(insert).toBeDefined();
    const values = insert![1]!;
    const expectedColor = "德利丰（大板）-洞石米白";
    expect(values[2]).toBe(previous.materialId);
    expect(values[8]).toBe("免漆浴室柜（主卫）");
    expect(JSON.parse(values[10] as string)).toEqual([expectedColor]);
    expect(values.slice(11, 14)).toEqual(["M", "4500.00", "2800.00"]);
    expect(JSON.parse(values[14] as string)).toMatchObject({
      variantGroup: "定制浴室柜:免漆浴室柜（主卫）", variantColor: expectedColor,
      imageReference: previous.attributes.imageReference,
    });
    expect(query.mock.calls.find(([sql]) => sql.includes("INSERT INTO main_material_item_assets"))?.[0])
      .toContain("old.material_id = next.material_id");
    expect(previous.colors).toEqual(["德利丰（大板）-洞石米白"]);
  });
});

function toDatabaseRow(item: NormalizedMainMaterialItem & { assetIds: string[] }) {
  return {
    id: "previous-item", catalog_version_id: "previous-catalog", material_id: item.materialId,
    category_code: item.categoryCode, category_name: item.categoryName, item_name: item.itemName,
    brand: item.brand, series: item.series, model: item.model, spec: item.spec, colors: item.colors,
    unit: item.unit, sale_price: item.salePrice, cost_price: item.costPrice, attributes: item.attributes,
    data_status: item.status, record_version: item.recordVersion, missing_fields: item.missingFields,
    source_file: item.sourceFile, source_sheet: item.sourceSheet, source_row: item.sourceRow,
    price_derivation: item.priceDerivation, remarks: item.remarks, asset_ids: item.assetIds,
  };
}
