import { describe, expect, it } from "vitest";
import { selectionImpact } from "../src/main-material/main-material-safe-update";

const item = {
  id: "old", catalog_version_id: "v1", material_id: "material", category_code: "SHOWER",
  category_name: "淋浴房", item_name: "淋浴房", brand: "朗格", series: "开门", model: "34A",
  spec: "旧规格", colors: [], unit: "M²", sale_price: "1000.00", cost_price: "800.00",
  attributes: {}, data_status: "ACTIVE", remarks: "说明", asset_ids: ["image"],
};
const line = { ...item, id: "line", item_version_id: "old", origin: "MANUAL", selected_color: null,
  sale_unit_price: "1000.0000", cost_unit_price: "800.0000" };

describe("zero-impact catalog update", () => {
  it("keeps both legacy and typed 34A colours valid when the catalog is unchanged", () => {
    const shower = { ...item, material_id: "MAT-SHOWER-DC6F85FFDF14", colors: ["枪灰拉丝"] };
    for (const selected_color of ["枪灰拉丝", "类型：T型｜颜色：枪灰拉丝"]) {
      expect(selectionImpact({ ...line, material_id: shower.material_id, selected_color }, shower, shower)).toEqual([]);
    }
  });
  it("ignores version/provenance identifiers but not business fields", () => {
    expect(selectionImpact(line, item, { ...item, id: "new", catalog_version_id: "v2", record_version: 99 })).toEqual([]);
  });
  it.each([
    ["model", "39AT"], ["spec", "新规格"], ["brand", "另一品牌"], ["item_name", "新名称"],
    ["sale_price", "999.00"], ["cost_price", "750.00"], ["unit", "套"],
    ["colors", ["黑"]], ["asset_ids", ["another-image"]], ["attributes", { glassColors: '["透明"]' }],
    ["remarks", "新说明"], ["data_status", "INACTIVE"],
  ])("blocks a change to %s", (field, value) => {
    expect(selectionImpact(line, item, { ...item, [field]: value }).length).toBeGreaterThan(0);
  });
  it("blocks missing products and inconsistent saved snapshots", () => {
    expect(selectionImpact(line, item, undefined).length).toBeGreaterThan(0);
    expect(selectionImpact({ ...line, model: "手工旧型号" }, item, item).length).toBeGreaterThan(0);
  });
  it("does not silently accept legacy incomplete glass selections", () => {
    const glass = { ...item, category_code: "GLASS_DOOR", colors: ["黑"], attributes: { glassColors: '["透明"]' } };
    expect(selectionImpact({ ...line, category_code: "GLASS_DOOR", selected_color: "黑" }, glass, glass).length).toBeGreaterThan(0);
    expect(selectionImpact({ ...line, category_code: "GLASS_DOOR", selected_color: "门框：黑｜玻璃：透明" }, glass, glass)).toEqual([]);
  });
});
