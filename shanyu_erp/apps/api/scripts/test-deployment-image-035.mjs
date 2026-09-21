// Explicit opt-in, isolated synthetic database only; never reads .env files.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { material035, old035, new035 } from "./deployment-image-035.mjs";
import { up } from "../../../migrations/035_shower_34a_image.mjs";

if (process.env.POSTGRES_HOST !== "127.0.0.1" || process.env.POSTGRES_PORT !== "55435" ||
    !/^shanyu_image035_test(?:_[a-z0-9]+)?$/.test(process.env.POSTGRES_DB ?? "") || process.env.SHANYU_IMAGE035_TEST !== "1") {
  throw new Error("Only dedicated local 035 fixture is allowed");
}
const root = resolve(import.meta.dirname, "../../..");
const client = new pg.Client({ host: process.env.POSTGRES_HOST, port: 55435,
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
await client.connect();
let passed = 0;
const pass = name => { passed++; console.log(`PASS ${name}`); };
function cli(mode, baseline, authorized = true) {
  return spawnSync(process.execPath, [resolve(import.meta.dirname, "deployment-data-baseline.mjs"), mode,
    ...(authorized ? ["--image-correction=035"] : [])], {
    cwd: root, env: process.env, input: baseline ? JSON.stringify({ baseline }) : undefined, encoding: "utf8",
  });
}
function verify(baseline, ok = true) {
  const result = cli("verify", baseline);
  assert.equal(result.status === 0, ok, result.stderr);
}
try {
  const migrations = (await client.query("SELECT name FROM schema_migrations ORDER BY id")).rows;
  assert.equal(migrations.at(-1).name, "032_main_material_catalog_0919");
  const actor = randomUUID(), batch = randomUUID(), template = randomUUID(), catalog = randomUUID();
  await client.query("INSERT INTO users (id,account,display_name,role,status) VALUES ($1,$2,'035合成用户','ADMIN','ACTIVE')", [actor, actor]);
  await client.query(`INSERT INTO catalog_import_batches (id,file_name,file_hash,source_sheet,status,validation_report,created_by_user_id)
    VALUES ($1,'035 synthetic',repeat('0',64),'fixture','VALIDATED','{}',$2)`, [batch, actor]);
  await client.query("INSERT INTO half_package_template_versions (id,version_number,source_batch_id,published_by_user_id) VALUES ($1,999,$2,$3)", [template, batch, actor]);
  await client.query("INSERT INTO main_material_catalog_versions (id,version_number,name,status,source_type) VALUES ($1,999,'035 fixture','VALIDATED','FULL')", [catalog]);
  const card = "a".repeat(64), otherCard = "c".repeat(64);
  for (const id of [card, otherCard]) await client.query("INSERT INTO main_material_assets (id,content_type,file_name,storage_path,size_bytes) VALUES ($1::text,'image/png',$1::text,$1::text,1)", [id]);
  for (const id of [material035, "NON-TARGET-SAME-IMAGE"]) {
    await client.query(`INSERT INTO main_material_item_versions (id,catalog_version_id,material_id,category_code,category_name,item_name,unit,data_status,record_version,colors)
      VALUES ($1,$2,$3,'SHOWER','淋浴房','035 fixture','M²','ACTIVE',1,'["保留色卡颜色"]')`, [randomUUID(), catalog, id]);
    for (const [index, asset] of [old035, card, otherCard].entries()) await client.query(
      "INSERT INTO main_material_item_assets (catalog_version_id,material_id,asset_id,sort_order) VALUES ($1,$2,$3,$4)", [catalog, id, asset, index]);
  }
  await client.query("UPDATE main_material_catalog_versions SET status='SUPERSEDED' WHERE id=$1", [catalog]);
  const ids = [];
  for (const [index, status] of ["DRAFT", "QUOTED", "RETURNED", "APPROVED", "DRAFT"].entries()) {
    const project = randomUUID(), quote = randomUUID(), line = randomUUID(); ids.push(line);
    await client.query(`INSERT INTO projects (id,project_address,customer_name,outer_frame_area,lead_designer_id,created_by_user_id)
      VALUES ($1,'035 fixture','合成',100,$2,$2)`, [project, actor]);
    await client.query(`INSERT INTO half_package_quotations
      (id,project_id,project_address,template_version_id,cost_template_version_id,quantity_rule_version_id,outer_frame_area,management_rate,created_by_user_id,main_material_catalog_version_id)
      VALUES ($1,$2,'035 fixture',$3,$3,(SELECT id FROM half_package_quantity_rule_versions LIMIT 1),100,0.1,$4,$5)`, [quote, project, template, actor, catalog]);
    await client.query(`INSERT INTO main_material_quote_lines
      (id,quotation_id,origin,category_code,scope_name,demand_name,demand_spec,base_quantity,loss_rate,quote_quantity,material_id,asset_ids,selected_color,sort_order)
      VALUES ($1,$2,'MANUAL','SHOWER','项目级','035 fixture','fixture',1,0,1,$3,$4,'保留色卡颜色',1)`,
    [line, quote, index === 4 ? "NON-TARGET-SAME-IMAGE" : material035,
      JSON.stringify(index === 1 ? [card, new035, old035, otherCard, old035] : [old035, card, otherCard])]);
    if (status !== "DRAFT") await client.query("UPDATE half_package_quotations SET status=$1,submitted_at=now(),submitted_by_user_id=$3 WHERE id=$2", [status, quote, actor]);
  }
  const captured = cli("snapshot"); assert.equal(captured.status, 0, captured.stderr);
  const baseline = JSON.parse(captured.stdout);
  const normal = cli("snapshot", null, false); assert.equal(normal.status, 0, normal.stderr);
  // Force failure after image writes but before guards are re-enabled. PostgreSQL
  // must roll back both data and transactional trigger DDL, without a restore.
  const faultSql = []; await up({ sql: text => faultSql.push(text) });
  await client.query("BEGIN");
  await assert.rejects(client.query(faultSql.join("\n").replace(
    "ALTER TABLE main_material_item_assets ENABLE TRIGGER", "SELECT 1 / 0; ALTER TABLE main_material_item_assets ENABLE TRIGGER")));
  await client.query("ROLLBACK");
  const rolledBack = cli("snapshot"); assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.deepEqual(JSON.parse(rolledBack.stdout), baseline);
  pass("failed 035 transaction restores all rows and protection triggers without database restore");
  const migration = spawnSync(process.execPath, ["scripts/run-migrations.mjs", "up"], { cwd: root, env: process.env, encoding: "utf8" });
  assert.equal(migration.status, 0, migration.stderr);
  verify(baseline); pass("032 → 033–035, exact historical image-only verification");
  assert.notEqual(cli("verify", JSON.parse(normal.stdout), false).status, 0); pass("ordinary baseline rejects 035 without explicit authorization");
  for (const [index, id] of ids.entries()) {
    const row = (await client.query("SELECT asset_ids,selected_color FROM main_material_quote_lines WHERE id=$1", [id])).rows[0];
    assert.deepEqual(row.asset_ids, [index === 4 ? old035 : new035, card, otherCard]);
    assert.equal(row.selected_color, "保留色卡颜色");
  }
  pass("full ordered image arrays/color cards preserved; non-target sharing old image unchanged");
  await assert.rejects(client.query("UPDATE main_material_quote_lines SET demand_name='tamper' WHERE id=$1", [ids[1]]));
  await assert.rejects(client.query("UPDATE main_material_item_assets SET sort_order=9 WHERE catalog_version_id=$1", [catalog]));
  pass("historical quotation and catalog protection triggers actually reject writes");
  for (const [sql, values, undo, undoValues] of [
    ["UPDATE main_material_quote_lines SET demand_name='tamper' WHERE id=$1", [ids[0]], "UPDATE main_material_quote_lines SET demand_name='035 fixture' WHERE id=$1", [ids[0]]],
    ["UPDATE main_material_quote_lines SET asset_ids=$2 WHERE id=$1", [ids[0], JSON.stringify([new035, otherCard, card])], "UPDATE main_material_quote_lines SET asset_ids=$2 WHERE id=$1", [ids[0], JSON.stringify([new035, card, otherCard])]],
    ["UPDATE main_material_quote_lines SET asset_ids=$2 WHERE id=$1", [ids[4], JSON.stringify([new035, card, otherCard])], "UPDATE main_material_quote_lines SET asset_ids=$2 WHERE id=$1", [ids[4], JSON.stringify([old035, card, otherCard])]],
    ["ALTER TABLE main_material_quote_lines DISABLE TRIGGER main_material_quote_lines_immutable", [], "ALTER TABLE main_material_quote_lines ENABLE TRIGGER main_material_quote_lines_immutable", []],
    ["UPDATE main_material_assets SET storage_path='wrong' WHERE id=$1", [new035], "UPDATE main_material_assets SET storage_path=$2 WHERE id=$1", [new035, `main-materials/v1/images/${new035}.png`]],
  ]) {
    await client.query(sql, values); verify(baseline, false); await client.query(undo, undoValues); verify(baseline);
  }
  pass("reject unrelated business changes, reordered cards, non-target changes, disabled guards, wrong registration");
  const beforeRepeat = JSON.parse(cli("snapshot").stdout);
  await client.query("BEGIN");
  try { const sql = []; await up({ sql: text => sql.push(text) }); for (const text of sql) await client.query(text); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  verify(beforeRepeat); verify(baseline); pass("035 direct repeat is idempotent and guards restored");
  const again = spawnSync(process.execPath, ["scripts/run-migrations.mjs", "up"], { cwd: root, env: process.env, encoding: "utf8" });
  assert.equal(again.status, 0, again.stderr); verify(beforeRepeat); pass("migration runner repeat makes no changes");
  console.log(`035 isolated regression: ${passed} groups passed`);
} finally { await client.end(); }
