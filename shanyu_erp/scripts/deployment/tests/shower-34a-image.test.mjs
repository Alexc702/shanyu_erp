import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { up, down } from "../../../migrations/035_shower_34a_image.mjs";

const oldImage = "547f7108b0fc470f638bdb35cb6db252621ea2a0417b7b4d57a18a5768776029";
const newImage = "b81f83d09bc071504448c4d6f5a9dae0c2b0770ced1aad8292a6ef374a579766";
const materialId = "MAT-SHOWER-DC6F85FFDF14";

test("34A packaged image matches immutable asset hash; no implicit rollback", async () => {
  const image = await readFile(`apps/api/assets/main-materials/v1/images/${newImage}.png`);
  assert.equal(createHash("sha256").update(image).digest("hex"), newImage);
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  await assert.rejects(down, /不可自动回退/);
});

test("34A replaces all catalog/quote images only, retains swatches and future FULL inheritance", {
  skip: process.env.SHANYU_SAFE_UPDATE_DB_TEST !== "1",
}, async () => {
  assert.equal(process.env.POSTGRES_HOST, "127.0.0.1");
  assert.equal(process.env.POSTGRES_DB, "shanyu_catalog_safe_test");
  const require = createRequire(new URL("../../../apps/api/package.json", import.meta.url));
  const { Pool } = require("pg");
  const pool = new Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Transaction-local tables shadow public tables; no application rows are touched.
    await client.query(`
      CREATE TEMP TABLE main_material_assets (id text PRIMARY KEY, content_type text, file_name text, storage_path text, size_bytes bigint);
      CREATE TEMP TABLE main_material_item_versions (catalog_version_id text, material_id text, price numeric);
      CREATE TEMP TABLE main_material_item_assets (catalog_version_id text, material_id text, asset_id text, sort_order integer,
        PRIMARY KEY(catalog_version_id, material_id, asset_id));
      CREATE TEMP TABLE main_material_quote_lines (id text PRIMARY KEY, material_id text, asset_ids jsonb, status text, quantity numeric, price numeric);
      CREATE FUNCTION pg_temp.reject_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END $$;
      CREATE TRIGGER main_material_item_assets_immutable BEFORE UPDATE OR DELETE ON main_material_item_assets FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_change();
      CREATE TRIGGER main_material_quote_lines_immutable BEFORE UPDATE OR DELETE ON main_material_quote_lines FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_change();
    `);
    for (const version of ["old", "current"]) {
      await client.query("INSERT INTO main_material_item_versions VALUES ($1,$2,1250)", [version, materialId]);
      await client.query("INSERT INTO main_material_item_assets VALUES ($1,$2,$3,0),($1,$2,'color-swatch',1)", [version, materialId, oldImage]);
    }
    await client.query("INSERT INTO main_material_item_assets VALUES ('current','other',$1,0)", [oldImage]);
    for (const status of ["DRAFT", "QUOTED", "APPROVED", "RETURNED"]) {
      await client.query("INSERT INTO main_material_quote_lines VALUES ($1,$2,$3,$1,2.5,1250)", [status, materialId, JSON.stringify([oldImage, "color-swatch"])]);
    }
    await client.query("INSERT INTO main_material_quote_lines VALUES ('other','other',$1,'QUOTED',3,99)", [JSON.stringify([oldImage])]);
    const business = await client.query("SELECT id, material_id, status, quantity, price FROM main_material_quote_lines ORDER BY id");
    const items = await client.query("SELECT * FROM main_material_item_versions ORDER BY catalog_version_id");
    let sql;
    await up({ sql: value => { sql = value; } });
    await client.query(sql);
    const first = await client.query("SELECT * FROM main_material_item_assets ORDER BY catalog_version_id,material_id,sort_order");
    await client.query(sql); // Idempotency, including snapshots and duplicate links.
    assert.deepEqual((await client.query("SELECT * FROM main_material_item_assets ORDER BY catalog_version_id,material_id,sort_order")).rows, first.rows);
    assert.deepEqual((await client.query("SELECT id, material_id, status, quantity, price FROM main_material_quote_lines ORDER BY id")).rows, business.rows);
    assert.deepEqual((await client.query("SELECT * FROM main_material_item_versions ORDER BY catalog_version_id")).rows, items.rows);
    const quotes = (await client.query("SELECT * FROM main_material_quote_lines")).rows;
    for (const row of quotes) assert.deepEqual(row.asset_ids, row.material_id === materialId ? [newImage, "color-swatch"] : [oldImage]);
    assert.equal(first.rows.filter(row => row.material_id === materialId && row.asset_id === newImage).length, 2);
    assert.equal(first.rows.filter(row => row.material_id === materialId && row.asset_id === oldImage).length, 0);
    assert.equal(first.rows.find(row => row.material_id === "other").asset_id, oldImage);
    // FULL publication's existing association-copy query must inherit the corrected image.
    await client.query("INSERT INTO main_material_item_versions VALUES ('next',$1,1250)", [materialId]);
    await client.query(`INSERT INTO main_material_item_assets
      SELECT 'next', next.material_id, old.asset_id, old.sort_order
      FROM main_material_item_versions next JOIN main_material_item_assets old
      ON old.catalog_version_id='current' AND old.material_id=next.material_id WHERE next.catalog_version_id='next'`);
    assert.deepEqual((await client.query("SELECT asset_id FROM main_material_item_assets WHERE catalog_version_id='next' ORDER BY sort_order")).rows.map(row => row.asset_id), [newImage, "color-swatch"]);
    const triggers = await client.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid IN ('pg_temp.main_material_item_assets'::regclass,'pg_temp.main_material_quote_lines'::regclass)");
    assert.ok(triggers.rows.every(row => row.tgenabled === "O"));
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
