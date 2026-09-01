import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const { hashPassword } = require("../dist/access/password.js");

const pool = new pg.Pool({
  database: requiredEnvironmentVariable("POSTGRES_DB"),
  host: process.env.POSTGRES_HOST ?? "127.0.0.1",
  password: requiredEnvironmentVariable("POSTGRES_PASSWORD"),
  port: Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
  user: requiredEnvironmentVariable("POSTGRES_USER"),
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('shanyu-erp:bootstrap-admin')::bigint)",
  );
  const existing = await client.query(
    `SELECT id, account
       FROM users
      WHERE role = 'ADMIN'
      ORDER BY created_at
      LIMIT 1`,
  );
  if (existing.rowCount) {
    await client.query("ROLLBACK");
    console.log("已存在 ADMIN 账号，未修改账号或密码。");
  } else {
    const account = requiredEnvironmentVariable("ADMIN_ACCOUNT");
    const displayName = requiredEnvironmentVariable("ADMIN_DISPLAY_NAME");
    const password = requiredEnvironmentVariable("ADMIN_PASSWORD");
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(account)) {
      throw new Error(
        "ADMIN_ACCOUNT 必须是 3–64 位字母、数字、点、下划线或连字符",
      );
    }
    if (displayName.length > 100) {
      throw new Error("ADMIN_DISPLAY_NAME 不得超过 100 个字符");
    }
    if (
      password.length < 8 ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      throw new Error("ADMIN_PASSWORD 至少 8 位，且必须包含数字与字母");
    }
    const userId = randomUUID();
    await client.query(
      `INSERT INTO users
         (id, account, display_name, phone, role, status)
       VALUES ($1, $2, $3, NULL, 'ADMIN', 'ACTIVE')`,
      [userId, account, displayName],
    );
    await client.query(
      `INSERT INTO user_credentials (user_id, password_hash)
       VALUES ($1, $2)`,
      [userId, await hashPassword(password)],
    );
    await client.query(
      `INSERT INTO audit_events
         (id, action, actor_user_id, occurred_at, result,
          target_type, target_id, metadata)
       VALUES ($1, 'USER_BOOTSTRAPPED', NULL, current_timestamp, 'SUCCESS',
               'USER', $2, $3::jsonb)`,
      [
        randomUUID(),
        userId,
        JSON.stringify({ account, source: "PRODUCTION_BOOTSTRAP" }),
      ],
    );
    await client.query("COMMIT");
    console.log(`已创建首个 ADMIN 账号：${account}`);
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}
