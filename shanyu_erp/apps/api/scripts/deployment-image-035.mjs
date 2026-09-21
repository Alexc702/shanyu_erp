// The only authorized historical image correction. Never a general asset bypass.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const material035 = "MAT-SHOWER-DC6F85FFDF14";
export const old035 = "547f7108b0fc470f638bdb35cb6db252621ea2a0417b7b4d57a18a5768776029";
export const new035 = "b81f83d09bc071504448c4d6f5a9dae0c2b0770ced1aad8292a6ef374a579766";
const storage = `main-materials/v1/images/${new035}.png`;
const hash = value => createHash("sha256").update(value).digest("hex");
export function corrected035(expression) {
  return `CASE WHEN t.material_id='${material035}' THEN jsonb_set(${expression}, '{asset_ids}',
    jsonb_build_array('${new035}'::text) || coalesce((SELECT jsonb_agg(value ORDER BY ordinal)
    FROM jsonb_array_elements(t.asset_ids) WITH ORDINALITY AS images(value,ordinal)
    WHERE value #>> '{}' NOT IN ('${old035}','${new035}')), '[]'::jsonb)) ELSE ${expression} END`;
}

export async function image035Evidence(client, before) {
  let image;
  for (const root of ["assets", "apps/api/assets"]) {
    try { image = readFileSync(resolve(root, storage)); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!image || hash(image) !== new035) throw new Error("035 file identity mismatch");
  const fingerprint = async sql => hash(JSON.stringify((await client.query(sql)).rows));
  const digestRows = sql => `SELECT encode(sha256(convert_to(row::text,'UTF8')),'hex') AS hash
    FROM (${sql}) records ORDER BY row::text`;
  const stable = {};
  for (const table of ["main_material_catalog_versions", "main_material_item_versions", "main_material_import_batches"]) {
    stable[table] = await fingerprint(digestRows(`SELECT to_jsonb(t) AS row FROM ${table} t`));
  }
  // All existing asset metadata, including timestamps, must be preserved.
  stable.assets = await fingerprint(digestRows(`SELECT to_jsonb(t) AS row FROM main_material_assets t WHERE id <> '${new035}'`));
  const asset = (await client.query("SELECT * FROM main_material_assets WHERE id=$1", [new035])).rows[0];
  if (asset && (asset.content_type !== "image/png" || asset.file_name !== `${new035}.png` ||
      asset.storage_path !== storage || asset.size_bytes !== image.length)) throw new Error("035 asset registration mismatch");
  const triggers = (await client.query(`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition,
      pg_get_functiondef(t.tgfoid) AS function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname IN
      ('main_material_item_assets_immutable','main_material_quote_lines_immutable') ORDER BY t.tgname`)).rows;
  if (triggers.length !== 2 || triggers.some(t => t.tgenabled !== "O")) throw new Error("035 snapshot guards not enabled");
  stable.triggers = hash(JSON.stringify(triggers));
  const links = `SELECT to_jsonb(t) AS row FROM main_material_item_assets t`;
  const expectedLinks = `${links} WHERE NOT (material_id='${material035}' AND asset_id IN ('${old035}','${new035}'))
    UNION ALL SELECT jsonb_build_object('catalog_version_id',catalog_version_id,'material_id',material_id,
    'asset_id','${new035}','sort_order',0) AS row FROM main_material_item_versions WHERE material_id='${material035}'`;
  const currentLinks = await fingerprint(digestRows(links));
  const expected = await fingerprint(digestRows(expectedLinks));
  const applied = (await client.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name='035_shower_34a_image'")).rows[0].n;
  if (before) {
    if (applied !== 1 || !asset || JSON.stringify(stable) !== JSON.stringify(before.stable) ||
        currentLinks !== before.expectedLinks || (before.asset && JSON.stringify(asset) !== JSON.stringify(before.asset))) {
      throw new Error("035 unexpected catalog/image/guard changes");
    }
  }
  return { policy: "035_shower_34a_image", stable, expectedLinks: expected, asset: asset ?? null,
    fileSha256: new035, fileBytes: image.length,
    catalogCount: (await client.query("SELECT count(*)::int AS n FROM main_material_item_versions WHERE material_id=$1", [material035])).rows[0].n,
    quotationRowCount: (await client.query("SELECT count(*)::int AS n FROM main_material_quote_lines WHERE material_id=$1", [material035])).rows[0].n };
}
