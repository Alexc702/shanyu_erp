// Deliberately restricted to the existing, synthetic local integration database.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";

if (process.env.SHANYU_SAFE_UPDATE_DB_TEST !== "1" || process.env.POSTGRES_DB !== "shanyu_catalog_safe_test" ||
    !["127.0.0.1", "localhost", "::1"].includes(process.env.POSTGRES_HOST)) throw new Error("Isolated local database only");
const pool = new pg.Pool({ host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT),
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
const run = (mode, input) => spawnSync(process.execPath, ["scripts/deployment-data-baseline.mjs", mode],
  { input: input && JSON.stringify(input), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const id = randomUUID();
try {
  const initial = run("snapshot");
  assert.equal(initial.status, 0, initial.stderr);
  const baseline = JSON.parse(initial.stdout);
  assert.equal(run("verify", { baseline }).status, 0);
  await pool.query("INSERT INTO users(id,account,display_name,role,status) VALUES($1,$2,'合成基线测试','ADMIN','ACTIVE')", [id, id]);
  await pool.query("INSERT INTO user_credentials(user_id,password_hash) VALUES($1,'synthetic-not-a-real-password-hash')", [id]);
  assert.notEqual(run("verify", { baseline }).status, 0, "added users must be detected");
  const next = run("snapshot");
  assert.equal(next.status, 0, next.stderr);
  assert.ok(!next.stdout.includes("synthetic-not-a-real-password-hash"), "credential values must not leak");
  const newBaseline = JSON.parse(next.stdout);
  await pool.query("UPDATE user_credentials SET password_hash='changed-synthetic-value' WHERE user_id=$1", [id]);
  assert.notEqual(run("verify", { baseline: newBaseline }).status, 0, "credential overwrite must be detected");
  await pool.query("DELETE FROM user_credentials WHERE user_id=$1", [id]);
  await pool.query("DELETE FROM users WHERE id=$1", [id]);
  assert.equal(run("verify", { baseline }).status, 0, "original fixture must remain unchanged");
  process.stdout.write("PASS real PostgreSQL baseline: unchanged, insert, credential overwrite, secret redaction, fixture preservation\n");
} finally {
  await pool.query("DELETE FROM user_credentials WHERE user_id=$1", [id]);
  await pool.query("DELETE FROM users WHERE id=$1", [id]);
  await pool.end();
}
