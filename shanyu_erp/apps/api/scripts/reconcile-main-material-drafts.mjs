import pg from "pg";
import { reconcileSafeDrafts } from "../dist/main-material/main-material-safe-update.js";

// Runs inside the API image or from apps/api after building. Never loads env files.
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const environmentArg = args.find(arg => arg.startsWith("--environment="));
const environment = environmentArg?.split("=")[1] ?? "local";
const target = args.find(arg => arg.startsWith("--target="))?.slice(9);
const hash = args.find(arg => arg.startsWith("--catalog-hash="))?.split("=")[1];
const plan = args.find(arg => arg.startsWith("--plan-hash="))?.split("=")[1];
const release = args.find(arg => arg.startsWith("--release="))?.split("=")[1];
if (args.some(arg => arg !== "--apply" && arg !== "--dry-run" && !["--environment=", "--target=", "--catalog-hash=", "--plan-hash=", "--release="].some(prefix => arg.startsWith(prefix))) ||
    (apply && args.includes("--dry-run")) || !["local", "test", "production"].includes(environment) ||
    (target !== undefined && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(target)) ||
    [hash, plan].some(value => value !== undefined && !/^[0-9a-f]{64}$/.test(value)) ||
    (environment !== "local" && (!target || !hash || !release || (apply && !plan)))) {
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
let committed = false;
let commitAttempted = false;
try {
  client = await pool.connect();
  await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '120s'");
  const report = await reconcileSafeDrafts(client, { apply, targetCatalogId: target, targetCatalogHash: hash, expectedPlanHash: plan });
  commitAttempted = true;
  await client.query("COMMIT");
  committed = true;
  process.stdout.write(`${JSON.stringify({ environment, release, mode: apply ? "apply" : "dry-run", ...report }, null, 2)}\n`);
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  // Do not log connection strings, credentials or raw database error details.
  process.stderr.write(`主材安全更新失败，${committed ? "数据库已提交，需人工核查报告" : commitAttempted ? "提交结果不确定，需人工核查数据库" : "未提交脚本更改"}（${error.code ?? "CHECK_FAILED"}）。\n`);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
