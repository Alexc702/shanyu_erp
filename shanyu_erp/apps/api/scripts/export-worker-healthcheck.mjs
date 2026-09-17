import { constants } from "node:fs";
import { access } from "node:fs/promises";
import pg from "pg";

const storageDirectory = requiredEnvironmentVariable("EXPORT_STORAGE_DIR");
const pool = new pg.Pool({
  connectionTimeoutMillis: 3_000,
  database: requiredEnvironmentVariable("POSTGRES_DB"),
  host: process.env.POSTGRES_HOST ?? "127.0.0.1",
  max: 1,
  password: requiredEnvironmentVariable("POSTGRES_PASSWORD"),
  port: Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
  query_timeout: 3_000,
  user: requiredEnvironmentVariable("POSTGRES_USER"),
});

try {
  await access(storageDirectory, constants.R_OK | constants.W_OK);
  await pool.query("SELECT 1 FROM quotation_export_jobs LIMIT 1");
} catch (error) {
  console.error(
    "export-worker healthcheck failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}
