import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { runner } from "node-pg-migrate";
import { describe, expect, it } from "vitest";

describe.skipIf(process.env.SHANYU_SAFE_UPDATE_DB_TEST !== "1")("039 scoped material update / isolated PostgreSQL", () => {
  it("adds eight items, changes only three sales prices, preserves snapshots/assets and is idempotent", async () => {
    if (process.env.POSTGRES_HOST !== "127.0.0.1" || process.env.POSTGRES_PORT !== "55449" || process.env.POSTGRES_DB !== "shanyu_catalog_safe_test") throw Error("Only task-isolated PostgreSQL allowed");
    const connection = { host: "127.0.0.1", port: 55449, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD };
    const name = `shanyu_art_paint_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ ...connection, database: "postgres" });
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    const db = new Pool({ ...connection, database: name });
    const options = { databaseUrl: { ...connection, database: name }, dir: resolve(process.cwd(), "../../migrations"), direction: "up" as const, migrationsTable: "schema_migrations", log: () => {} };
    const business = async () => {
      const state = [];
      for (const table of ["projects", "half_package_quotations", "main_material_quote_lines", "audit_events", "half_package_exports"]) state.push((await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows);
      return JSON.stringify(state);
    };
    const items = async (id: string) => (await db.query("SELECT to_jsonb(i)-'id'-'catalog_version_id'-'created_at' AS data FROM main_material_item_versions i WHERE catalog_version_id=$1 ORDER BY material_id", [id])).rows.map(r => r.data);
    try {
      await runner({ ...options, count: 38 });
      const source = (await db.query("SELECT id FROM main_material_catalog_versions WHERE status='PUBLISHED'")).rows[0].id;
      const actor = randomUUID(), batch = randomUUID(), template = randomUUID(), project = randomUUID(), quote = randomUUID();
      await db.query("INSERT INTO users(id,account,display_name,role,status) VALUES($1,$2,'测试','OWNER','ACTIVE')", [actor, actor]);
      await db.query("INSERT INTO catalog_import_batches(id,file_name,file_hash,source_sheet,status,validation_report,created_by_user_id) VALUES($1,'测试','0000000000000000000000000000000000000000000000000000000000000000','测试','VALIDATED','{}',$2)", [batch, actor]);
      await db.query("INSERT INTO half_package_template_versions(id,version_number,source_batch_id,published_by_user_id) VALUES($1,1,$2,$3)", [template, batch, actor]);
      await db.query("INSERT INTO projects(id,project_address,customer_name,outer_frame_area,lead_designer_id,created_by_user_id) VALUES($1,'测试','客户',100,$2,$2)", [project, actor]);
      await db.query(`INSERT INTO half_package_quotations(id,project_id,project_address,template_version_id,cost_template_version_id,quantity_rule_version_id,outer_frame_area,management_rate,created_by_user_id,main_material_catalog_version_id)
        SELECT $1,$2,'测试',$3,$3,id,100,0.1,$4,$5 FROM half_package_quantity_rule_versions LIMIT 1`, [quote, project, template, actor, source]);
      await db.query(`INSERT INTO main_material_quote_lines(id,quotation_id,origin,category_code,scope_name,demand_name,demand_spec,base_quantity,loss_rate,quote_quantity,item_version_id,material_id,item_name,brand,series,model,spec,unit,sale_unit_price,cost_unit_price,sale_amount,cost_amount)
        SELECT $1,$2,'MANUAL','SWITCH','全屋',item_name,spec,2,0,2,id,material_id,item_name,brand,series,model,spec,unit,sale_price,cost_price,sale_price*2,cost_price*2 FROM main_material_item_versions WHERE catalog_version_id=$3 AND material_id='MAT-SWITCH-3A72FA395FA7'`, [randomUUID(), quote, source]);
      await db.query("UPDATE half_package_quotations SET status='QUOTED',submitted_at=current_timestamp,submitted_by_user_id=$2 WHERE id=$1", [quote, actor]);
      const before = await items(source), protectedBefore = await business();
      const assetsBefore = (await db.query("SELECT material_id,asset_id,sort_order FROM main_material_item_assets WHERE catalog_version_id=$1 ORDER BY material_id,sort_order", [source])).rows;
      await runner({ ...options, count: 1 });
      const target = (await db.query("SELECT id FROM main_material_catalog_versions WHERE status='PUBLISHED'")).rows[0].id;
      const after = await items(target);
      expect(after).toHaveLength(before.length + 8);
      const byId = new Map(after.map(i => [i.material_id, i]));
      for (const old of before) expect(byId.get(old.material_id)).toEqual(old.category_code === "SWITCH" && old.brand === "公牛" ? { ...old, sale_price: 20, record_version: old.record_version + 1 } : old);
      expect(after.filter(i => i.category_code === "ART_PAINT")).toHaveLength(8);
      expect(after.filter(i => i.category_code === "SWITCH" && i.brand === "公牛").every(i => i.cost_price === 13 && i.unit === "M²")).toBe(true);
      expect(await items(source)).toEqual(before);
      expect(await business()).toBe(protectedBefore);
      expect((await db.query("SELECT material_id,asset_id,sort_order FROM main_material_item_assets WHERE catalog_version_id=$1 ORDER BY material_id,sort_order", [target])).rows).toEqual(assetsBefore);
      await runner(options);
      expect((await db.query("SELECT count(*)::int AS n FROM main_material_catalog_versions WHERE status='PUBLISHED'")).rows[0].n).toBe(1);
      expect(await items(target)).toEqual(after);
      const draft = randomUUID();
      await db.query(`INSERT INTO half_package_quotations(id,project_id,project_address,template_version_id,cost_template_version_id,quantity_rule_version_id,outer_frame_area,management_rate,created_by_user_id,main_material_catalog_version_id,version_number,is_current,parent_version_id)
        SELECT $1,$2,'测试',$3,$3,id,100,0.1,$4,$5,2,false,$6 FROM half_package_quantity_rule_versions LIMIT 1`, [draft, project, template, actor, target, quote]);
      await db.query(`INSERT INTO main_material_quote_lines(id,quotation_id,origin,category_code,scope_name,demand_name,demand_spec,quote_quantity)
        VALUES($1,$2,'MANUAL','ART_PAINT','全屋','北欧绮遇','',2)`, [randomUUID(), draft]);
      expect((await db.query("SELECT count(*)::int AS n FROM main_material_quote_lines WHERE quotation_id=$1 AND category_code='ART_PAINT'", [draft])).rows[0].n).toBe(1);
    } finally { await db.end(); }
  }, 60_000);
});
