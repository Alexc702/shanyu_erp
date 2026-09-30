import { describe, expect, it } from "vitest";

import { mainMaterialDemandTag } from "../src/catalog/pg-catalog.repository";

describe("small tile demand tags", () => {
  it.each([
    ["70*200mm小砖（胶泥粘帖）", "50*200"],
    ["70*300mm小砖（胶泥粘帖）", "60*200"],
    ["50*200mm小砖（胶泥粘帖）", "50*200"],
    ["800*800mm地砖（水泥砂浆粘贴）", "800*800"],
  ])("uses the displayed tile size for %s", (name, spec) => {
    expect(mainMaterialDemandTag(name)?.targetSpec).toBe(spec);
  });
});
