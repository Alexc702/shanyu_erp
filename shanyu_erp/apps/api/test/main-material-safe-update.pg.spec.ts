import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseClient, DatabaseExecutor } from "../src/database/database.client";
import { reconcileSafeDrafts } from "../src/main-material/main-material-safe-update";
import { PgMainMaterialRepository } from "../src/main-material/pg-main-material.repository";
import { PgQuotationRepository } from "../src/quotation/pg-quotation.repository";
import type { ProjectsRepository } from "../src/project/projects.repository";
import type { CatalogRepository } from "../src/catalog/catalog.repository";
import { AccessPolicy } from "../src/access/access.policy";
import { PgAuditRepository } from "../src/access/pg-audit.repository";
import { PgProjectsRepository } from "../src/project/pg-projects.repository";
import { QuotationService } from "../src/quotation/quotation.service";
import { HalfPackageCalculator } from "../src/quotation/half-package-calculator";

const enabled = process.env.SHANYU_SAFE_UPDATE_DB_TEST === "1";
describe.skipIf(!enabled)("safe catalog update / isolated PostgreSQL", () => {
  let pool: Pool, client: PoolClient, database: DatabaseClient;
  let actor: string, oldCatalog: string, newCatalog: string, oldItem: string, newItem: string;
  beforeAll(() => {
    if (!["127.0.0.1", "localhost", "::1"].includes(process.env.POSTGRES_HOST ?? "") ||
        process.env.POSTGRES_DB !== "shanyu_catalog_safe_test") throw new Error("Only the isolated local test database is allowed");
    pool = new Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
      user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB });
  });
  afterAll(async () => { await pool?.end(); });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    database = {
      query: (sql: string, values?: readonly unknown[]) => client.query(sql, values ? [...values] : []),
      transaction: async <T>(work: (db: DatabaseExecutor) => Promise<T>) => {
        await client.query("SAVEPOINT operation");
        try { const result = await work(database); await client.query("RELEASE SAVEPOINT operation"); return result; }
        catch (error) { await client.query("ROLLBACK TO SAVEPOINT operation"); throw error; }
      },
    } as DatabaseClient;
    actor = randomUUID(); oldCatalog = randomUUID(); newCatalog = randomUUID(); oldItem = randomUUID(); newItem = randomUUID();
    await client.query("INSERT INTO users (id, account, display_name, role, status) VALUES ($1,$2,'本地测试','ADMIN','ACTIVE')", [actor, actor]);
    const batchId = randomUUID();
    await client.query(`INSERT INTO catalog_import_batches
      (id,file_name,file_hash,source_sheet,status,validation_report,created_by_user_id)
      VALUES ($1,'合成模板','0000000000000000000000000000000000000000000000000000000000000000','测试','VALIDATED','{}',$2)`, [batchId, actor]);
    await client.query(`INSERT INTO half_package_template_versions (id,version_number,source_batch_id,published_by_user_id)
      VALUES ($1,999,$2,$3)`, [randomUUID(), batchId, actor]);
    await client.query("UPDATE main_material_catalog_versions SET status='SUPERSEDED' WHERE status='PUBLISHED'");
    for (const [index, id] of [oldCatalog, newCatalog].entries()) {
      await client.query(`INSERT INTO main_material_catalog_versions (id,version_number,name,status,source_type)
        VALUES ($1,$2,'安全测试库','VALIDATED','FULL')`, [id, 100 + index]);
      await client.query(`INSERT INTO main_material_item_versions
        (id,catalog_version_id,material_id,category_code,category_name,item_name,brand,series,model,spec,unit,sale_price,cost_price,data_status,record_version)
        VALUES ($1,$2,'SAFE-SHOWER','SHOWER','淋浴房','淋浴房','朗格','开门','34A','原规格','M²',1000,800,'ACTIVE',1)`, [index ? newItem : oldItem, id]);
    }
    await client.query("UPDATE main_material_catalog_versions SET status='PUBLISHED' WHERE id=$1", [oldCatalog]);
  });
  afterEach(async () => { await client.query("ROLLBACK"); client.release(); });

  async function publish() {
    await client.query("UPDATE main_material_catalog_versions SET status='SUPERSEDED' WHERE id=$1", [oldCatalog]);
    await client.query("UPDATE main_material_catalog_versions SET status='PUBLISHED' WHERE id=$1", [newCatalog]);
  }
  async function draft(withLine = true) {
    const projectId = randomUUID(), id = randomUUID();
    await client.query(`INSERT INTO projects (id,project_address,customer_name,outer_frame_area,lead_designer_id,created_by_user_id)
      VALUES ($1,'本地合成项目','测试客户',100,$2,$2)`, [projectId, actor]);
    await client.query(`INSERT INTO half_package_quotations
      (id,project_id,project_address,template_version_id,cost_template_version_id,quantity_rule_version_id,
       outer_frame_area,management_rate,created_by_user_id,main_material_catalog_version_id,is_current,
       total,expected_cost,main_material_direct_cost,main_material_management_fee,main_material_total,main_material_expected_cost,
       discount_rate,write_off,adjusted_total,gross_profit,gross_margin_rate,adjustment_reason)
      SELECT $1,$2,'本地合成项目',t.id,t.id,(SELECT id FROM half_package_quantity_rule_versions LIMIT 1),
       100,0.1,$3,$4,true,1000,600,1000,100,1100,800,0.95,2,1993,593,0.2975,'原优惠原因'
      FROM half_package_template_versions t ORDER BY version_number DESC LIMIT 1`, [id, projectId, actor, oldCatalog]);
    if (withLine) await client.query(`INSERT INTO main_material_quote_lines
      (id,quotation_id,origin,category_code,scope_name,demand_name,demand_spec,base_quantity,base_quantity_overridden,
       loss_rate,quote_quantity,item_version_id,material_id,item_name,brand,series,model,spec,unit,sale_unit_price,cost_unit_price,sale_amount,cost_amount,sort_order)
      VALUES ($1,$2,'MANUAL','SHOWER','项目级','原需求','原规格',1,true,0,1,$3,'SAFE-SHOWER','淋浴房','朗格','开门','34A','原规格','M²',1000,800,1000,800,1)`,
    [randomUUID(), id, oldItem]);
    return { id, projectId };
  }
  async function state() {
    const result: Record<string, unknown> = {};
    for (const table of ["half_package_quotations", "half_package_quotation_spaces", "half_package_quotation_lines", "main_material_quote_lines", "audit_events", "half_package_exports"]) {
      result[table] = (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    }
    return JSON.stringify(result);
  }
  async function row(id: string) { return (await client.query("SELECT * FROM half_package_quotations WHERE id=$1", [id])).rows[0]; }
  async function lines(id: string) { return (await client.query("SELECT * FROM main_material_quote_lines WHERE quotation_id=$1 ORDER BY sort_order", [id])).rows; }

  it("dry-run is read-only; apply changes only references/revision and is idempotent", async () => {
    const q = await draft(); await publish(); const before = await state();
    expect((await reconcileSafeDrafts(database, { apply: false })).entries.find(e => e.quotationId === q.id)?.outcome).toBe("SAFE");
    expect(await state()).toBe(before);
    const header = await row(q.id), saved = (await lines(q.id))[0];
    expect((await database.transaction(db => reconcileSafeDrafts(db, { apply: true }))).entries.find(e => e.quotationId === q.id)?.outcome).toBe("UPDATED");
    expect(await row(q.id)).toEqual({ ...header, main_material_catalog_version_id: newCatalog, revision: header.revision + 1, updated_at: expect.any(Date) });
    expect((await lines(q.id))[0]).toEqual({ ...saved, item_version_id: newItem });
    const once = await state(); await database.transaction(db => reconcileSafeDrafts(db, { apply: true }));
    expect(await state()).toBe(once);
  });
  it("pins catalog content and the preview, rejecting stale plans atomically", async () => {
    const q = await draft(); await publish();
    const preview = await reconcileSafeDrafts(database, { apply: false });
    const before = await state();
    await expect(database.transaction(db => reconcileSafeDrafts(db, { apply: true,
      targetCatalogId: newCatalog, targetCatalogHash: "0".repeat(64), expectedPlanHash: preview.planHash }))).rejects.toThrow();
    expect(await state()).toBe(before);
    await client.query("UPDATE half_package_quotations SET adjustment_reason='预览后业务修改' WHERE id=$1", [q.id]);
    const changed = await state();
    await expect(database.transaction(db => reconcileSafeDrafts(db, { apply: true,
      targetCatalogId: newCatalog, targetCatalogHash: preview.targetCatalogHash, expectedPlanHash: preview.planHash }))).rejects.toThrow();
    expect(await state()).toBe(changed);
    const fresh = await reconcileSafeDrafts(database, { apply: false });
    const result = await database.transaction(db => reconcileSafeDrafts(db, { apply: true,
      targetCatalogId: newCatalog, targetCatalogHash: fresh.targetCatalogHash, expectedPlanHash: fresh.planHash }));
    expect(result.planHash).toBe(fresh.planHash);
    expect(result.entries.find(e => e.quotationId === q.id)?.outcome).toBe("UPDATED");
    const again = await reconcileSafeDrafts(database, { apply: false });
    expect((await database.transaction(db => reconcileSafeDrafts(db, { apply: true,
      targetCatalogId: newCatalog, targetCatalogHash: again.targetCatalogHash, expectedPlanHash: again.planHash }))).summary.UPDATED).toBe(0);
  });
  it.each(["cost_price", "model", "colors"])("skips the whole quote when %s changes", async field => {
    const q = await draft();
    const value = field === "cost_price" ? "750" : field === "model" ? "39AT" : '["黑"]';
    await client.query(`UPDATE main_material_item_versions SET ${field}=$1 WHERE id=$2`, [value, newItem]);
    await publish(); const before = await state();
    expect((await database.transaction(db => reconcileSafeDrafts(db, { apply: true }))).entries.find(e => e.quotationId === q.id)?.outcome).toBe("BLOCKED");
    expect(await state()).toBe(before);
  });
  it("deleted products stay selected; other safe drafts can advance independently", async () => {
    const blocked = await draft(), safe = await draft(false);
    await client.query("DELETE FROM main_material_item_versions WHERE id=$1", [newItem]); await publish();
    const before = await lines(blocked.id);
    const result = await database.transaction(db => reconcileSafeDrafts(db, { apply: true }));
    expect(result.entries.find(e => e.quotationId === blocked.id)?.outcome).toBe("BLOCKED");
    expect(result.entries.find(e => e.quotationId === safe.id)?.outcome).toBe("UPDATED");
    expect(await lines(blocked.id)).toEqual(before);
  });
  it.each(["QUOTED", "RETURNED", "APPROVED"])("never modifies %s quotes", async status => {
    const q = await draft(); await client.query("UPDATE half_package_quotations SET status=$1, submitted_at=current_timestamp, submitted_by_user_id=$3 WHERE id=$2", [status, q.id, actor]);
    await publish(); const before = await state();
    expect((await database.transaction(db => reconcileSafeDrafts(db, { apply: true }))).entries.find(e => e.quotationId === q.id)?.outcome).toBe("PROTECTED");
    expect(await state()).toBe(before);
  });
  it.each(["QUOTED", "RETURNED"])("continues %s exactly, including legacy colors, amounts and manual quantity flags", async status => {
    const q = await draft();
    await client.query("UPDATE main_material_quote_lines SET selected_color='历史颜色' WHERE quotation_id=$1", [q.id]);
    await client.query("UPDATE half_package_quotations SET status=$1, submitted_at=current_timestamp, submitted_by_user_id=$3 WHERE id=$2", [status, q.id, actor]);
    await client.query("UPDATE main_material_item_versions SET cost_price=750,model='39AT' WHERE id=$1", [newItem]); await publish();
    const repo = new PgQuotationRepository(database, {} as ProjectsRepository, {} as CatalogRepository);
    const source = (await repo.findById(q.id))!, before = await row(q.id), saved = (await lines(q.id))[0];
    const copy = await repo.continueEditing(source, actor);
    for (const key of ["mainMaterialCatalogVersionId", "adjustedTotal", "discountRate", "writeOff", "adjustmentReason", "mainMaterialExpectedCost", "grossProfit"]) {
      expect(copy[key as keyof typeof copy]).toEqual(source[key as keyof typeof source]);
    }
    expect((await lines(copy.id))[0]).toEqual({ ...saved, id: expect.any(String), quotation_id: copy.id,
      created_at: expect.any(Date), updated_at: expect.any(Date) });
    expect(await row(q.id)).toEqual({ ...before, is_current: false, updated_at: expect.any(Date) });
    const inherited = await state();
    const result = await database.transaction(db => reconcileSafeDrafts(db, { apply: true }));
    expect(result.entries.find(e => e.quotationId === copy.id)?.outcome).toBe("PROTECTED");
    await new PgMainMaterialRepository(database).initializeAndSyncDraft(q.projectId, true);
    expect(await state()).toBe(inherited);
  });
  it("rechecks current content after preview and refuses a stale target", async () => {
    const q = await draft(); await publish();
    expect((await reconcileSafeDrafts(database, { apply: false })).entries.find(e => e.quotationId === q.id)?.outcome).toBe("SAFE");
    await client.query("UPDATE main_material_quote_lines SET model='用户后来修改' WHERE quotation_id=$1", [q.id]);
    const before = await state();
    expect((await database.transaction(db => reconcileSafeDrafts(db, { apply: true }))).entries.find(e => e.quotationId === q.id)?.outcome).toBe("BLOCKED");
    await expect(database.transaction(db => reconcileSafeDrafts(db, { apply: true, targetCatalogId: oldCatalog }))).rejects.toThrow();
    expect(await state()).toBe(before);
  });
  it("rolls back reference changes if auditing fails", async () => {
    await draft(); await publish(); const before = await state();
    await expect(database.transaction(db => reconcileSafeDrafts({ query: (sql, values) => {
      if (sql.includes("INSERT INTO audit_events")) throw new Error("simulated audit failure");
      return db.query(sql, values);
    } }, { apply: true }))).rejects.toThrow("simulated audit failure");
    expect(await state()).toBe(before);
  });
  it("publication automatically updates safe drafts and records its analysis", async () => {
    const q = await draft();
    const repository = new PgMainMaterialRepository(database);
    const batch = await repository.createImportBatch({ id: randomUUID(), createdByUserId: actor,
      fileName: "local-delta.xlsx", fileHash: "a".repeat(64), mode: "DELTA", payload: [],
      validation: { blockerCount: 0 }, status: "VALIDATED" });
    const published = await repository.publishImportBatch(batch.id, actor);
    expect((await row(q.id)).main_material_catalog_version_id).toBe(published.id);
    const audit = (await client.query("SELECT metadata FROM audit_events WHERE action='MAIN_MATERIAL_SAFE_UPDATE_ANALYZED' AND target_id=$1", [published.id])).rows[0];
    expect(audit.metadata.entries.find((e: { quotationId: string }) => e.quotationId === q.id).outcome).toBe("UPDATED");
  });
  it("targeted DELTA publication preserves untouched product metadata", async () => {
    await client.query("UPDATE main_material_catalog_versions SET status='VALIDATED' WHERE id=$1", [oldCatalog]);
    await client.query("UPDATE main_material_item_versions SET missing_fields='品牌、产品图' WHERE id=$1", [oldItem]);
    await client.query("UPDATE main_material_catalog_versions SET status='PUBLISHED' WHERE id=$1", [oldCatalog]);
    const repository = new PgMainMaterialRepository(database);
    const before = (await repository.getPublishedCatalog())!;
    const batch = await repository.createImportBatch({ id: randomUUID(), createdByUserId: actor,
      fileName: "local-delta.xlsx", fileHash: "b".repeat(64), mode: "DELTA", payload: [],
      validation: { blockerCount: 0 }, status: "VALIDATED" });
    const published = await repository.publishImportBatch(batch.id, actor);
    expect(published.items[0]).toEqual({ ...before.items[0], id: expect.any(String), catalogVersionId: published.id });
    expect((await repository.getCatalogById(oldCatalog))!.items).toEqual(before.items);
  });
  it("copies duplicate half-package item IDs using exact source-line identity", async () => {
    const q = await draft(false), scopeId = randomUUID(), halfIds = [randomUUID(), randomUUID()];
    const item = (await client.query("SELECT * FROM half_package_version_items ORDER BY id LIMIT 1")).rows[0];
    if (!item) throw new Error("Prepare the local half-package baseline before running this integration test");
    await client.query("INSERT INTO half_package_quotation_spaces (id,quotation_id,name,sort_order) VALUES ($1,$2,'重复工程项测试',0)", [scopeId,q.id]);
    for (const [index,id] of halfIds.entries()) {
      await client.query(`INSERT INTO half_package_quotation_lines
        (id,quotation_space_id,version_item_id,section_code,section_name,item_name,unit,sort_order,
        selected,quantity_rule_kind,manual_quantity,calculated_quantity,sale_unit_price,cost_unit_price,sale_amount,cost_amount,gross_profit,gross_margin_rate)
        VALUES ($1,$2,$3,'WALL','测试分区',$4,'M²',1,true,'MANUAL',$5,$5,100,50,$6,$7,$7,0.5)`,
      [id,scopeId,item.id,`不同施工方法${index}`,index+1,100*(index+1),50*(index+1)]);
      await client.query(`INSERT INTO main_material_quote_lines
        (id,quotation_id,origin,source_half_package_line_id,category_code,scope_name,demand_name,demand_spec,base_quantity,loss_rate,quote_quantity,sort_order)
        VALUES ($1,$2,'AUTO_TILE',$3,'TILE','重复工程项测试',$4,'600*600',$5,0.115,$6,$7)`,
      [randomUUID(),q.id,id,`不同施工方法${index}`,index+1,index===0?'1.1150':'2.2300',index]);
    }
    await client.query("UPDATE half_package_quotations SET status='QUOTED',submitted_at=current_timestamp,submitted_by_user_id=$2 WHERE id=$1", [q.id,actor]);
    const repo = new PgQuotationRepository(database, {} as ProjectsRepository, {} as CatalogRepository);
    const source = (await repo.findById(q.id))!;
    const next = await repo.continueEditing(source,actor);
    const pairs = (await client.query(`SELECT m.demand_name,l.item_name FROM main_material_quote_lines m
      JOIN half_package_quotation_lines l ON l.id=m.source_half_package_line_id WHERE m.quotation_id=$1`, [next.id])).rows;
    expect(pairs).toHaveLength(2);
    expect(pairs.every(p => p.demand_name===p.item_name)).toBe(true);
    const quantities = (value: typeof source) => Object.fromEntries(value.scopes[0]!.lines.map(l=>[l.itemName,l.calculatedQuantity]));
    expect(quantities(next)).toEqual(quantities(source));
  });
  it("holds a publication lock until the update transaction ends", async () => {
    await draft(); await publish(); await reconcileSafeDrafts(database, { apply: true });
    const other = await pool.connect();
    try {
      await other.query("BEGIN"); await other.query("SET LOCAL lock_timeout='50ms'");
      await expect(other.query("LOCK TABLE main_material_catalog_versions IN ROW EXCLUSIVE MODE")).rejects.toMatchObject({ code: "55P03" });
    } finally { await other.query("ROLLBACK"); other.release(); }
  });
  it.each(["remove", "quantity", "rollback"])("syncs explicit inherited tile edits atomically: %s", async (mode) => {
    const q = await draft(), scopeId = randomUUID(), halfId = randomUUID();
    const item = (await client.query(`SELECT vi.id FROM half_package_version_items vi
      JOIN half_package_main_material_demand_tags tag ON tag.standard_item_id=vi.standard_item_id LIMIT 1`)).rows[0];
    if (!item) throw new Error("Prepare the isolated half-package baseline first");
    await client.query("INSERT INTO half_package_quotation_spaces (id,quotation_id,name,sort_order) VALUES ($1,$2,'客餐厅',0)", [scopeId,q.id]);
    await client.query(`INSERT INTO half_package_quotation_lines
      (id,quotation_space_id,version_item_id,section_code,section_name,item_name,unit,sort_order,
       selected,quantity_rule_kind,manual_quantity,calculated_quantity,sale_unit_price,cost_unit_price,sale_amount,cost_amount,gross_profit,gross_margin_rate)
      VALUES ($1,$2,$3,'WALL','测试','200*700mm小砖','M²',1,true,'MANUAL',33,33,100,50,3300,1650,1650,0.5)`, [halfId,scopeId,item.id]);
    await client.query(`INSERT INTO main_material_quote_lines
      (id,quotation_id,origin,source_half_package_line_id,category_code,scope_name,demand_name,demand_spec,base_quantity,loss_rate,quote_quantity,sort_order)
      VALUES ($1,$2,'AUTO_TILE',$3,'TILE','客餐厅','200*700mm小砖','200*700',33,0.115,36.795,2)`, [randomUUID(),q.id,halfId]);
    await client.query("UPDATE half_package_quotations SET status='QUOTED',submitted_at=current_timestamp,submitted_by_user_id=$2 WHERE id=$1", [q.id,actor]);
    const repository = new PgQuotationRepository(database, new PgProjectsRepository(database), {} as CatalogRepository);
    const source = (await repository.findById(q.id))!;
    const next = await repository.continueEditing(source,actor);
    const originalLines = await lines(q.id), inheritedLines = await lines(next.id);
    const manual = inheritedLines.find(l => l.origin === "MANUAL");
    const service = new QuotationService(new AccessPolicy(), repository, new PgAuditRepository(database), new HalfPackageCalculator());
    const user = { id: actor, account: actor, displayName: "本地测试", role: "ADMIN" as const, phone: null };
    await publish();
    // Merely opening inherited drafts must remain read-only, even after catalog publication.
    const before = await state();
    await new PgMainMaterialRepository(database).initializeAndSyncDraft(q.projectId, true);
    expect(await state()).toBe(before);
    const lineId = next.scopes[0]!.lines[0]!.id;
    if (mode === "rollback") {
      await client.query(`CREATE FUNCTION pg_temp.reject_demand_delete() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN RAISE EXCEPTION ''test sync failure''; END'`);
      await client.query(`CREATE TRIGGER test_sync_failure BEFORE DELETE ON main_material_quote_lines
        FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_demand_delete()`);
      await expect(service.updateLine(user,q.projectId,lineId,{ expectedRevision: next.revision, selected: false, quantity: null })).rejects.toThrow("test sync failure");
      expect(await state()).toBe(before);
      return;
    }
    const saved = await service.updateLine(user,q.projectId,lineId,{
      expectedRevision: next.revision, selected: mode === "quantity", quantity: mode === "quantity" ? "12" : null,
    });
    const current = await lines(next.id);
    expect(current.find(l => l.origin === "MANUAL")).toEqual(manual);
    if (mode === "remove") expect(current.filter(l => l.origin === "AUTO_TILE")).toHaveLength(0);
    else expect(current.find(l => l.origin === "AUTO_TILE")).toMatchObject({ base_quantity: "12.0000", quote_quantity: "13.3800" });
    expect(await row(next.id)).toMatchObject({ main_material_catalog_version_id: oldCatalog, discount_rate: "0.9500", write_off: "2.0000", revision: saved.revision });
    expect(await repository.findById(q.id)).toEqual({ ...source, isCurrent: false });
    expect(await lines(q.id)).toEqual(originalLines);
    const after = await state();
    await new PgMainMaterialRepository(database).initializeAndSyncDraft(q.projectId, true);
    expect(await state()).toBe(after);
    await expect(service.updateLine(user,q.projectId,lineId,{
      expectedRevision: next.revision, selected: true, quantity: "10",
    })).rejects.toThrow("报价已被其他操作更新");
    expect(await state()).toBe(after);
    if (mode === "remove") {
      await service.updateLine(user,q.projectId,lineId,{ expectedRevision: saved.revision, selected: true, quantity: "5" });
      expect((await lines(next.id)).find(l => l.origin === "AUTO_TILE")).toMatchObject({ base_quantity: "5.0000", quote_quantity: "5.5750" });
      expect((await lines(next.id)).find(l => l.origin === "MANUAL")).toEqual(manual);
      expect(await lines(q.id)).toEqual(originalLines);
    }
  });
  it("0920 persists module adjustments and design fees across approval and continuation", async () => {
    const q = await draft();
    await client.query("UPDATE half_package_quotations SET design_fee_unit_price=50 WHERE id=$1", [q.id]);
    await client.query("UPDATE half_package_quotations SET status='QUOTED',submitted_at=current_timestamp,submitted_by_user_id=$2 WHERE id=$1", [q.id,actor]);
    const repository = new PgQuotationRepository(database, new PgProjectsRepository(database), {} as CatalogRepository);
    const source = (await repository.findById(q.id))!;
    const adjustment = { discountRate: "0.9800", writeOff: "1.0000" };
    const pending = await repository.saveAdjustment(q.id, "0.95", "2", "7025.0000", "5625", "0.8007", actor, "验收", source.revision, adjustment);
    expect(pending.mainMaterialAdjustment).toEqual(adjustment);
    expect(pending.designFeeUnitPrice).toBe("50.0000");
    const approved = await repository.decide(q.id, actor, "APPROVED", null);
    expect(approved.mainMaterialAdjustment).toEqual(adjustment);
    expect(approved.designFeeUnitPrice).toBe("50.0000");
    const returned = await repository.decide(approved.id, actor, "RETURNED", "验收返修");
    const next = await repository.continueEditing(returned, actor);
    expect(next.mainMaterialAdjustment).toEqual(adjustment);
    expect(next.designFeeUnitPrice).toBe("50.0000");
    expect(next.adjustedTotal).toBe(returned.adjustedTotal);
    expect((await repository.findById(approved.id))?.mainMaterialAdjustment).toEqual(adjustment);
  });

  it("service creation and reopening do not recalculate or repair inherited content", async () => {
    const q = await draft();
    await client.query("UPDATE half_package_quotations SET status='QUOTED',submitted_at=current_timestamp,submitted_by_user_id=$2 WHERE id=$1", [q.id,actor]);
    await publish();
    const repository = new PgQuotationRepository(database, new PgProjectsRepository(database), {} as CatalogRepository);
    const service = new QuotationService(new AccessPolicy(), repository, new PgAuditRepository(database), new HalfPackageCalculator());
    const user = { id: actor, account: actor, displayName: "本地测试", role: "ADMIN" as const, phone: null };
    const created = await service.continueEditing(user,q.id);
    expect(created.adjustedTotal).toBe("1993.0000");
    expect(created.discountRate).toBe("0.9500");
    expect(created.writeOff).toBe("2.0000");
    const before = await state();
    expect(await service.getOrCreateDraft(user,q.projectId)).toEqual(created);
    expect(await state()).toBe(before);
  });
});
