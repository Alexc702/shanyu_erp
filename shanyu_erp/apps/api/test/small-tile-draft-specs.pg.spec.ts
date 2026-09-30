import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

// @ts-expect-error migrations are executable JavaScript without TypeScript declarations
import { up } from "../../../migrations/040_small_tile_demand_specs.mjs";

describe.skipIf(process.env.SHANYU_SMALL_TILE_DB_TEST !== "1")("small-tile draft repair / isolated PostgreSQL", () => {
  it("corrects tags and current drafts without changing selected items or quoted snapshots", async () => {
    if (process.env.POSTGRES_HOST !== "127.0.0.1" || process.env.POSTGRES_PORT !== "55450" ||
        process.env.POSTGRES_DB !== "shanyu_small_tile_test") throw Error("Only task-isolated PostgreSQL allowed");
    const connection = { host: "127.0.0.1", port: 55450,
      user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD };
    const name = `shanyu_small_tile_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ ...connection, database: "postgres" });
    await admin.query(`CREATE DATABASE "${name}"`);
    const db = new Pool({ ...connection, database: name });
    const script = resolve(process.cwd(), "scripts/repair-small-tile-draft-specs.mjs");
    const scriptEnv = { ...process.env, POSTGRES_HOST: connection.host,
      POSTGRES_PORT: String(connection.port), POSTGRES_DB: name,
      POSTGRES_USER: connection.user, POSTGRES_PASSWORD: connection.password };
    const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args],
      { env: scriptEnv, encoding: "utf8" });
    try {
      await db.query(`CREATE TABLE half_package_version_items (standard_item_id uuid, item_name text);
        CREATE TABLE half_package_main_material_demand_tags (standard_item_id uuid, target_spec text);
        CREATE TABLE schema_migrations (name text);
        CREATE TABLE half_package_quotations (id uuid PRIMARY KEY, project_id uuid, revision integer,
          status text, is_current boolean, updated_at timestamptz DEFAULT current_timestamp);
        CREATE TABLE half_package_quotation_lines (id uuid PRIMARY KEY, item_name text, selected boolean);
        CREATE TABLE main_material_quote_lines (id uuid PRIMARY KEY, quotation_id uuid,
          source_half_package_line_id uuid, origin text, demand_name text, demand_spec text,
          item_version_id uuid, spec text, updated_at timestamptz DEFAULT current_timestamp)`);
      for (const [oldName, oldSpec] of [
        ["70*200mm小砖（胶泥粘帖）", "70*200"],
        ["70*300mm小砖（胶泥粘帖）", "70*300"],
        ["其他小砖", "70*200"],
      ]) {
        const id = randomUUID();
        await db.query("INSERT INTO half_package_version_items VALUES($1,$2)", [id, oldName]);
        await db.query("INSERT INTO half_package_main_material_demand_tags VALUES($1,$2)", [id, oldSpec]);
      }
      const migrationSql: string[] = [];
      await up({ sql: (statement: string) => migrationSql.push(statement) });
      for (const statement of migrationSql) await db.query(statement);
      await db.query("INSERT INTO schema_migrations VALUES('040_small_tile_demand_specs')");
      expect((await db.query(`SELECT tag.target_spec FROM half_package_main_material_demand_tags tag
        JOIN half_package_version_items item USING(standard_item_id) ORDER BY item.item_name`)).rows
        .map((row) => row.target_spec).sort()).toEqual(["50*200", "60*200", "70*200"]);

      const currentQuote = randomUUID(), historicalQuote = randomUUID(), blockedQuote = randomUUID();
      const project = randomUUID(), historicalProject = randomUUID(), blockedProject = randomUUID();
      for (const [id, projectId, status] of [
        [currentQuote, project, "DRAFT"], [historicalQuote, historicalProject, "QUOTED"],
        [blockedQuote, blockedProject, "DRAFT"],
      ]) await db.query("INSERT INTO half_package_quotations(id,project_id,revision,status,is_current) VALUES($1,$2,1,$3,true)", [id, projectId, status]);
      const addLine = async (quoteId: string, name: string, spec: string, selectedSpec: string | null) => {
        const sourceId = randomUUID(), lineId = randomUUID();
        await db.query("INSERT INTO half_package_quotation_lines VALUES($1,$2,true)", [sourceId, name]);
        await db.query(`INSERT INTO main_material_quote_lines
          (id,quotation_id,source_half_package_line_id,origin,demand_name,demand_spec,item_version_id,spec)
          VALUES($1,$2,$3,'AUTO_TILE',$4,$5,$6,$7)`,
        [lineId, quoteId, sourceId, name, spec, selectedSpec ? randomUUID() : null, selectedSpec]);
        return lineId;
      };
      const first = await addLine(currentQuote, "50*200mm小砖（胶泥粘帖）", "70*200", null);
      const second = await addLine(currentQuote, "60*200mm小砖（胶泥粘帖）", "70*300", null);
      const historical = await addLine(historicalQuote, "50*200mm小砖（胶泥粘帖）", "70*200", null);
      const blocked = await addLine(blockedQuote, "50*200mm小砖（胶泥粘帖）", "70*200", "70*200");
      const preview = run("--dry-run", "--environment=local");
      expect(preview.status).toBe(0);
      const firstPlan = JSON.parse(preview.stdout);
      expect(firstPlan.summary).toEqual({ projects: 2, updated: 2, blocked: 1 });
      expect(run("--apply", "--environment=local", `--plan-hash=${firstPlan.planHash}`).status).not.toBe(0);
      expect((await db.query("SELECT demand_spec FROM main_material_quote_lines WHERE id=$1", [first])).rows[0].demand_spec).toBe("70*200");
      await db.query("UPDATE main_material_quote_lines SET spec='50*200' WHERE id=$1", [blocked]);
      expect(run("--apply", "--environment=local", `--plan-hash=${firstPlan.planHash}`).status).not.toBe(0);
      const reviewed = JSON.parse(run("--dry-run", "--environment=local").stdout);
      expect(reviewed.summary).toEqual({ projects: 2, updated: 3, blocked: 0 });
      const applied = run("--apply", "--environment=local", `--plan-hash=${reviewed.planHash}`);
      expect(applied.status, applied.stderr).toBe(0);
      expect((await db.query("SELECT id,demand_spec FROM main_material_quote_lines WHERE id=ANY($1::uuid[]) ORDER BY id", [[first, second, historical, blocked]])).rows)
        .toEqual(expect.arrayContaining([
          { id: first, demand_spec: "50*200" }, { id: second, demand_spec: "60*200" },
          { id: historical, demand_spec: "70*200" }, { id: blocked, demand_spec: "50*200" },
        ]));
      expect((await db.query("SELECT id,revision FROM half_package_quotations WHERE id=ANY($1::uuid[])", [[currentQuote, historicalQuote, blockedQuote]])).rows)
        .toEqual(expect.arrayContaining([{ id: currentQuote, revision: 2 },
          { id: historicalQuote, revision: 1 }, { id: blockedQuote, revision: 2 }]));
      expect(JSON.parse(run("--dry-run", "--environment=local").stdout).summary)
        .toEqual({ projects: 0, updated: 0, blocked: 0 });
    } finally {
      await db.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30_000);
});
