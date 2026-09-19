import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const migration = pathToFileURL(resolve(process.cwd(), "../../migrations/032_main_material_catalog_0919.mjs")).href;
const baseline = resolve(process.cwd(), "assets/main-materials/v1/catalog-0919.json");
const roots: string[] = [];

function workspace() {
  const root = mkdtempSync(resolve(tmpdir(), "shanyu-migration-032-"));
  roots.push(root);
  return root;
}

function placeBaseline(root: string, layout: string, content?: string) {
  const target = resolve(root, layout, "main-materials/v1/catalog-0919.json");
  mkdirSync(dirname(target), { recursive: true });
  if (content === undefined) copyFileSync(baseline, target);
  else writeFileSync(target, content);
}

function generateSql(root: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { up } = await import(${JSON.stringify(migration)});
    let calls = 0;
    await up({ sql(statement) {
      if (!statement.includes('32323232-3232-4232-8232-323232323232')) throw new Error('Wrong catalog');
      if (!statement.includes('a942fb745b2069b08498467657cf80c16e0a9e1e8e3e36b953c9f5c28e53f9da')) throw new Error('Wrong baseline');
      calls++;
    } });
    if (calls !== 1) throw new Error('Migration SQL was not generated');
  `], { cwd: root, encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("migration 032 baseline asset paths", () => {
  it.each(["apps/api/assets", "assets"])("loads the committed baseline in %s layout", layout => {
    const root = workspace();
    placeBaseline(root, layout);
    const result = generateSql(root);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("refuses a missing baseline rather than generating an empty catalog", () => {
    const result = generateSql(workspace());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("找不到0919主材库基线资产");
  });

  it("does not fall back past malformed source JSON", () => {
    const root = workspace();
    placeBaseline(root, "apps/api/assets", "invalid JSON");
    placeBaseline(root, "assets");
    const result = generateSql(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SyntaxError");
  });

  it("refuses malformed packaged JSON", () => {
    const root = workspace();
    placeBaseline(root, "assets", "invalid JSON");
    const result = generateSql(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SyntaxError");
  });
});
