import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { expect, it } from "vitest";
import type { DatabaseClient, DatabaseExecutor } from "../src/database/database.client";
import { PgMainMaterialRepository } from "../src/main-material/pg-main-material.repository";
import { parseMainMaterialWorkbook } from "../src/main-material/main-material-workbook";
import { MainMaterialRevisionConflictError } from "../src/main-material/main-material.repository";

// Uses the same PostgreSQL prerequisites as quotation.e2e; all writes roll back.
it("publishes FULL with valid mappings and monotonic versions without changing historical snapshots", async () => {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? "127.0.0.1", port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const database = {
      query: (sql: string, values?: readonly unknown[]) => client.query(sql, values ? [...values] : []),
      transaction: <T>(work: (executor: DatabaseExecutor) => Promise<T>) => work(database as DatabaseExecutor),
    } as unknown as DatabaseClient;
    const repository = new PgMainMaterialRepository(database);
    const old = (await repository.getPublishedCatalog())!;
    const before = JSON.stringify(old.items);
    const snapshots = await client.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(q) ORDER BY id)::text, '[]')) AS digest FROM main_material_quote_lines q");
    const actorId = randomUUID();
    await client.query("INSERT INTO users (id, account, display_name, role, status) VALUES ($1, $2, 'FULL回归', 'ADMIN', 'ACTIVE')", [actorId, `full-${actorId}`]);
    const parsed = await parseMainMaterialWorkbook(await readFile(resolve(process.cwd(), "test/fixtures/main-material-0919.xlsx")), "FULL");
    const batch = await repository.createImportBatch({
      id: randomUUID(), createdByUserId: actorId, fileName: "0919回归.xlsx", fileHash: randomUUID(),
      mode: "FULL", payload: parsed.payload, validation: { ...parsed.validation }, status: "VALIDATED",
    });
    const published = await repository.publishImportBatch(batch.id, actorId);
    expect(published.items).toHaveLength(694);
    expect(published.items.find((item) => item.materialId === "MAT-SHOWER-DC6F85FFDF14")?.assetIds[0])
      .toBe("b81f83d09bc071504448c4d6f5a9dae0c2b0770ced1aad8292a6ef374a579766");
    expect(published.items.filter((i) => i.status === "ACTIVE")).toHaveLength(601);
    const oldById = new Map(old.items.map((i) => [i.materialId, i]));
    for (const item of published.items) {
      expect(item.recordVersion).toBeGreaterThan(oldById.get(item.materialId)?.recordVersion ?? 0);
      for (const key of ["colorAssetMap", "glassColorAssetMap"]) {
        for (const id of Object.values(JSON.parse(item.attributes[key] || "{}"))) expect(item.assetIds).toContain(id);
      }
    }
    expect(JSON.stringify((await repository.getCatalogById(old.id))!.items)).toBe(before);
    expect((await client.query("SELECT md5(coalesce(jsonb_agg(to_jsonb(q) ORDER BY id)::text, '[]')) AS digest FROM main_material_quote_lines q")).rows).toEqual(snapshots.rows);
    expect((await repository.publishImportBatch(batch.id, actorId)).id).toBe(published.id);
    const previous = old.items.find((i) => published.items.some((n) => n.materialId === i.materialId))!;
    await expect(repository.validateDelta([{ materialId: previous.materialId, expectedRecordVersion: previous.recordVersion, operation: "UPSERT", changeReason: "过期版本", values: { sale_price: "100" } }])).rejects.toBeInstanceOf(MainMaterialRevisionConflictError);

    const door = published.items.find((i) => i.materialId === "MAT-GLASS_DOOR-FBACE026D73F")!;
    const invalidDelta = [{ materialId: door.materialId, expectedRecordVersion: door.recordVersion,
      operation: "UPSERT" as const, changeReason: "未登记色卡", values: { color: "不存在的门框颜色" } }];
    // Online edits and DELTA uploads both validate through this repository method.
    await expect(repository.validateDelta(invalidDelta)).rejects.toThrow("缺少有效色卡资产关联");
    const invalidBatch = await repository.createImportBatch({
      id: randomUUID(), createdByUserId: actorId, fileName: "过期已校验批次", fileHash: randomUUID(),
      mode: "DELTA", payload: invalidDelta, validation: { blockerCount: 0 }, status: "VALIDATED",
    });
    await expect(repository.publishImportBatch(invalidBatch.id, actorId)).rejects.toThrow("缺少有效色卡资产关联");
    expect((await repository.getPublishedCatalog())!.id).toBe(published.id);

    const delta = [{ ...invalidDelta[0]!, changeReason: "保留合法颜色", values: { color: door.colors[0]! } }];
    await repository.validateDelta(delta);
    const deltaBatch = await repository.createImportBatch({
      id: randomUUID(), createdByUserId: actorId, fileName: "合法色卡Delta", fileHash: randomUUID(),
      mode: "DELTA", payload: delta, validation: { blockerCount: 0 }, status: "VALIDATED",
    });
    const updated = await repository.publishImportBatch(deltaBatch.id, actorId);
    const changed = updated.items.find((i) => i.materialId === door.materialId)!;
    expect(changed.recordVersion).toBe(door.recordVersion + 1);
    expect(changed.assetIds).toEqual(door.assetIds);
    expect(Object.keys(JSON.parse(changed.attributes.colorAssetMap!))).toEqual([door.colors[0]]);
    expect(JSON.parse(changed.attributes.glassColors!)).toEqual([]);
    for (const item of updated.items.filter((i) => i.materialId !== door.materialId)) {
      const original = published.items.find((i) => i.materialId === item.materialId)!;
      expect(item.recordVersion).toBe(original.recordVersion);
      expect(item.attributes).toEqual(original.attributes);
      expect(item.assetIds).toEqual(original.assetIds);
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
}, 20_000);
