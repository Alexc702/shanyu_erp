import { createHash } from "node:crypto";
import pg from "pg";

// Correct only the two renamed small-tile demands in current editable drafts.
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const environment = args.find((arg) => arg.startsWith("--environment="))?.slice(14);
const expectedPlanHash = args.find((arg) => arg.startsWith("--plan-hash="))?.slice(12);
if (args.some((arg) => !["--apply", "--dry-run"].includes(arg) &&
    !arg.startsWith("--environment=") && !arg.startsWith("--plan-hash=")) ||
    args.includes("--apply") === args.includes("--dry-run") ||
    !["local", "test", "production"].includes(environment) ||
    (apply && !/^[0-9a-f]{64}$/.test(expectedPlanHash ?? "")) ||
    (!apply && expectedPlanHash !== undefined)) {
  throw new Error("用法：repair-small-tile-draft-specs.mjs --dry-run|--apply --environment=local|test|production [--plan-hash=<预览哈希>]");
}
const host = process.env.POSTGRES_HOST ?? "127.0.0.1";
if (environment === "local" && !["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error("local 模式只允许本机数据库");
}
for (const key of ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`缺少环境变量 ${key}`);
}

const pool = new pg.Pool({ host, port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD });
let client;
let commitAttempted = false;
try {
  client = await pool.connect();
  await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '120s'");
  const migration = await client.query("SELECT 1 FROM schema_migrations WHERE name = '040_small_tile_demand_specs' LIMIT 1");
  if (migration.rowCount !== 1) throw new Error("须先完成 040 迁移");
  const { rows } = await client.query(`SELECT q.project_id, q.id AS quotation_id, q.revision,
      line.id AS line_id, line.demand_name, line.demand_spec, line.item_version_id,
      line.spec AS selected_spec, source.item_name AS source_name, source.selected AS source_selected
    FROM main_material_quote_lines line
    JOIN half_package_quotations q ON q.id = line.quotation_id
    LEFT JOIN half_package_quotation_lines source ON source.id = line.source_half_package_line_id
    WHERE q.status = 'DRAFT' AND q.is_current AND line.origin = 'AUTO_TILE'
      AND ((line.demand_name = '50*200mm小砖（胶泥粘帖）' AND line.demand_spec = '70*200')
        OR (line.demand_name = '60*200mm小砖（胶泥粘帖）' AND line.demand_spec = '70*300'))
    ORDER BY q.project_id, q.id, line.id
    ${apply ? "FOR UPDATE OF q, line" : ""}`);
  const normalize = (spec) => spec?.toLowerCase().replaceAll("×", "*").replaceAll("x", "*")
    .replaceAll("mm", "").replaceAll(" ", "");
  const entries = rows.map((row) => {
    const targetSpec = row.demand_spec === "70*200" ? "50*200" : "60*200";
    const blocker = row.source_name !== row.demand_name || !row.source_selected
      ? "半包来源行已变化"
      : row.item_version_id && normalize(row.selected_spec) !== targetSpec
        ? "已选商品规格与新目标规格不符"
        : null;
    return { projectId: row.project_id, quotationId: row.quotation_id, revision: row.revision,
      lineId: row.line_id, demandName: row.demand_name, from: row.demand_spec, to: targetSpec,
      selectedItemVersionId: row.item_version_id, selectedSpec: row.selected_spec,
      sourceName: row.source_name, sourceSelected: row.source_selected,
      status: blocker ? "BLOCKED" : "UPDATE", reason: blocker };
  });
  const planHash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  if (apply) {
    if (planHash !== expectedPlanHash || entries.some((entry) => entry.status === "BLOCKED")) {
      throw new Error("预览已变化或存在不兼容选型；未更新任何项目");
    }
    for (const entry of entries) {
      const changed = await client.query(`UPDATE main_material_quote_lines
        SET demand_spec = $3, updated_at = current_timestamp
        WHERE id = $1 AND quotation_id = $2 AND demand_spec = $4`,
      [entry.lineId, entry.quotationId, entry.to, entry.from]);
      if (changed.rowCount !== 1) throw new Error("草稿需求行已变化");
    }
    const quotations = new Map(entries.map((entry) => [entry.quotationId, entry.revision]));
    for (const [quotationId, revision] of quotations) {
      const changed = await client.query(`UPDATE half_package_quotations
        SET revision = revision + 1, updated_at = current_timestamp
        WHERE id = $1 AND revision = $2 AND status = 'DRAFT' AND is_current`,
      [quotationId, revision]);
      if (changed.rowCount !== 1) throw new Error("草稿版本已变化");
    }
  }
  commitAttempted = true;
  await client.query("COMMIT");
  process.stdout.write(`${JSON.stringify({ environment, mode: apply ? "apply" : "dry-run", planHash,
    summary: { projects: new Set(entries.map((entry) => entry.projectId)).size,
      updated: entries.filter((entry) => entry.status === "UPDATE").length,
      blocked: entries.filter((entry) => entry.status === "BLOCKED").length }, entries }, null, 2)}\n`);
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  process.stderr.write(`小砖草稿规格更正失败，${commitAttempted ? "提交结果需核查" : "未提交更改"}（${error.code ?? "CHECK_FAILED"}）。\n`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
