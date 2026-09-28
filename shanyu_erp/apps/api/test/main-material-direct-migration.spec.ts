import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { runner } from "node-pg-migrate";
import { describe, expect, it } from "vitest";

describe.skipIf(process.env.SHANYU_SAFE_UPDATE_DB_TEST!=="1")("direct-import migration / task-isolated databases",()=>{
  for(const upgrade of [false,true]) it(upgrade ? "upgrades 037 without changing existing business rows" : "installs all migrations including direct blob archives on a fresh database",async()=>{
    if(process.env.POSTGRES_HOST!=="127.0.0.1"||process.env.POSTGRES_PORT!=="55449"||process.env.POSTGRES_DB!=="shanyu_catalog_safe_test")throw Error("Only task-isolated PostgreSQL allowed");
    const connection={host:"127.0.0.1",port:55449,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD};
    const admin=new Pool({...connection,database:"postgres"}),name=`shanyu_direct_migration_${randomUUID().replaceAll("-","")}`;
    await admin.query(`CREATE DATABASE "${name}"`);await admin.end();
    const db=new Pool({...connection,database:name});
    const options={databaseUrl:{...connection,database:name},dir:resolve(process.cwd(),"../../migrations"),direction:"up" as const,migrationsTable:"schema_migrations",log:()=>{}};
    async function fingerprint(){const values=[];for(const table of ["main_material_catalog_versions","main_material_item_versions","main_material_assets","projects","half_package_quotations","main_material_quote_lines"]){values.push((await db.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS rows FROM ${table} t`)).rows);}return createHash("sha256").update(JSON.stringify(values)).digest("hex");}
    try{
      if(upgrade){await runner({...options,count:37});const before=await fingerprint();await runner(options);expect(await fingerprint()).toBe(before);}else await runner(options);
      expect((await db.query("SELECT count(*)::int AS count FROM schema_migrations")).rows[0].count).toBe(38);
      expect((await db.query("SELECT count(*)::int AS count FROM direct_material_import_blobs")).rows[0].count).toBe(0);
      expect((await db.query("SELECT count(*)::int AS count FROM direct_material_imports")).rows[0].count).toBe(0);
    }finally{await db.end();}
  },60_000);
});
