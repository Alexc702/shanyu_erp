import pg from "pg";
import { reconcileSafeDrafts } from "../dist/main-material/main-material-safe-update.js";

// Runs inside the API image or from apps/api after building. Never loads env files.
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const environmentArg = args.find(arg => arg.startsWith("--environment="));
const environment = environmentArg?.split("=")[1] ?? "local";
const target = args.find(arg => arg.startsWith("--target="))?.slice(9);
if (args.some(arg => arg !== "--apply" && arg !== "--dry-run" && !arg.startsWith("--environment=") && !arg.startsWith("--target=")) ||
    (apply && args.includes("--dry-run")) || !["local", "test", "production"].includes(environment) ||
    (target !== undefined && !/^[0-9a-f-]{36}$/i.test(target))) {
  throw new Error("用法：reconcile-main-material-drafts.mjs [--dry-run|--apply] --environment=local|test|production [--target=UUID]");
}
const host = process.env.POSTGRES_HOST ?? "127.0.0.1";
if (environment === "local" && !["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error("local 模式只允许本机数据库");
}
for (const key of ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`缺少环境变量 ${key}`);
}
const pool = new pg.Pool({ host, port: Number(process.env.POSTGRES_PORT ?? "5432"),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
let client;
try {
  client = await pool.connect();
  await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '120s'");
  const report = await reconcileSafeDrafts(client, { apply, targetCatalogId: target });
  await client.query("COMMIT");
  process.stdout.write(`${JSON.stringify({ environment, mode: apply ? "apply" : "dry-run", ...report }, null, 2)}\n`);
} catch (error) {
  if (client) await client.query("ROLLBACK");
  // Do not log connection strings, credentials or raw database error details.
  process.stderr.write(`主材安全更新失败，未提交更改（${error.code ?? "CHECK_FAILED"}）。\n`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
