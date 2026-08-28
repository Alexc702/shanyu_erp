import { runner } from "node-pg-migrate";

const direction = process.argv[2];
if (direction !== "up" && direction !== "down") {
  throw new Error("用法：node scripts/run-migrations.mjs <up|down>");
}

const requiredVariables = [
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
];
for (const variableName of requiredVariables) {
  if (!process.env[variableName]) {
    throw new Error(`缺少环境变量 ${variableName}`);
  }
}

await runner({
  databaseUrl: {
    database: process.env.POSTGRES_DB,
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    password: process.env.POSTGRES_PASSWORD,
    port: Number.parseInt(process.env.POSTGRES_PORT ?? "5432", 10),
    user: process.env.POSTGRES_USER,
  },
  dir: "migrations",
  direction,
  count: direction === "down" ? 1 : undefined,
  migrationsTable: "schema_migrations",
});
