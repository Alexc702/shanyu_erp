// Read-only, row-level business fingerprints. No credential values leave PostgreSQL.
import pg from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { corrected035, image035Evidence } from "./deployment-image-035.mjs";

const tables = ["users", "user_credentials", "auth_sessions", "projects", "project_spaces",
  "half_package_quotations", "half_package_quotation_spaces", "half_package_quotation_lines",
  "half_package_approval_decisions", "main_material_quote_lines", "half_package_exports",
  "quotation_export_jobs", "audit_events"];
const mode = process.argv[2];
if (!["snapshot", "verify"].includes(mode)) throw new Error("Expected snapshot or verify");
const correction = process.argv[3] === "--image-correction=035";
if (process.argv.length > (correction ? 4 : 3)) throw new Error("Invalid baseline arguments");
const input = mode === "verify" ? JSON.parse(readFileSync(0, "utf8")) : null;
if (input && Boolean(input.baseline._image035) !== correction) throw new Error("035 authorization mismatch");
const pool = new pg.Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
const client = await pool.connect();
const sha = value => createHash("sha256").update(value).digest("hex");
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '120s'");
  const result = {};
  if (correction) result._image035 = await image035Evidence(client, input?.baseline._image035);
  for (const table of tables) {
    const columns = input?.baseline[table]?.columns ?? (await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table],
    )).rows.map(row => row.column_name);
    if (!columns.length || columns.some(column => !/^[a-z_][a-z0-9_]*$/.test(column))) throw new Error("Schema mismatch");
    const expression = `(SELECT to_jsonb(s) FROM (SELECT ${columns.map(column => `t."${column}"`).join(",")}) s)`;
    const expected = correction && table === "main_material_quote_lines" ? corrected035(expression) : expression;
    const relaxed = table === "half_package_quotations" ? ["main_material_catalog_version_id", "revision", "updated_at"] :
      table === "main_material_quote_lines" ? ["item_version_id"] : [];
    // PostgreSQL hashes canonical JSON; credential/file values never enter the report.
    const key = table === "user_credentials" ? "user_id" : "id";
    const rows = (await client.query(`SELECT t.${key}::text AS id, encode(sha256(convert_to((${expression})::text, 'UTF8')), 'hex') AS full,
      encode(sha256(convert_to(((${expression}) - $1::text[])::text, 'UTF8')), 'hex') AS business
      ${correction && table === "main_material_quote_lines" ? `, encode(sha256(convert_to((${expected})::text,'UTF8')),'hex') AS image035_full,
        encode(sha256(convert_to(((${expected}) - $1::text[])::text,'UTF8')),'hex') AS image035_business` : ""}
      ${table === "half_package_quotations" ? ", revision, main_material_catalog_version_id AS catalog" : ""}
      ${table === "main_material_quote_lines" ? ", quotation_id, item_version_id, material_id" : ""}
      ${table === "audit_events" ? ", action, target_id" : ""}
      FROM "${table}" t ORDER BY t.${key}`, [relaxed])).rows;
    result[table] = { columns, count: rows.length, hash: sha(JSON.stringify(rows)), rows };
    if (!input) continue;
    const before = input.baseline[table].rows;
    const updated = new Map((input.applied?.entries ?? []).filter(entry => entry.outcome === "UPDATED").map(entry => [entry.quotationId, entry]));
    const current = new Map(rows.map(row => [row.id, row]));
    for (const old of before) {
      const row = current.get(old.id);
      if (!row) throw new Error(`Missing row in ${table}`);
      const entry = updated.get(table === "half_package_quotations" ? old.id : old.quotation_id);
      if (entry && table === "half_package_quotations") {
        if (row.business !== old.business || row.revision !== old.revision + 1 || row.catalog !== input.applied.targetCatalogId || entry.fromCatalogId !== old.catalog) throw new Error("Quotation changed");
      } else if (entry && table === "main_material_quote_lines" && old.material_id) {
        const item = (await client.query("SELECT catalog_version_id, material_id FROM main_material_item_versions WHERE id=$1", [row.item_version_id])).rows[0];
        if (row.business !== (correction ? old.image035_business : old.business) || item?.catalog_version_id !== input.applied.targetCatalogId || item?.material_id !== old.material_id) throw new Error("Selection changed");
      } else if (row.full !== (correction && table === "main_material_quote_lines" ? old.image035_full : old.full)) throw new Error(`Changed row in ${table}`);
      current.delete(old.id);
    }
    if (table === "audit_events" && input.applied) {
      const targets = new Set();
      for (const row of current.values()) {
        if (row.action !== "MAIN_MATERIAL_SAFE_AUTO_UPDATED" || !updated.has(row.target_id) || targets.has(row.target_id)) throw new Error("Unexpected audit");
        targets.add(row.target_id);
      }
      if (targets.size !== updated.size) throw new Error("Missing update audit");
    } else if (current.size) throw new Error(`Unexpected new row in ${table}`);
  }
  await client.query("COMMIT");
  process.stdout.write(JSON.stringify(mode === "snapshot" ? result : { verified: true, image035: result._image035 ? {
    fileSha256: result._image035.fileSha256, catalogCount: result._image035.catalogCount,
    quotationRowCount: result._image035.quotationRowCount } : undefined,
    counts: Object.fromEntries(tables.map(table => [table, result[table].count])) }) + "\n");
} catch {
  await client.query("ROLLBACK");
  process.stderr.write("Business baseline verification failed; maintenance must remain active.\n");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
