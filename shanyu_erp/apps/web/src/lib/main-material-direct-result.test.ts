import { expect, it } from "vitest";
import type { DirectMaterialRowView } from "@shanyu/contracts";
import { directChangeCounts, directUnitOptions, directUnitValue } from "./main-material-direct-result";

const row = (result: DirectMaterialRowView["result"], fields: string[]) => ({ result, differences: fields.map(field => ({ field, before:"—", after:"100" })) });
it("merges meter and square-meter aliases only in import unit selects",()=>{
  expect(directUnitOptions).toEqual([["M","米（M）"],["M²","平米（M²）"],["个","个"],["套","套"],["樘","樘"],["片","片"]]);
  for(const unit of ["米","M"]) expect(directUnitValue(unit)).toBe("M");
  for(const unit of ["平方","平米","平方米","M²"]) expect(directUnitValue(unit)).toBe("M²");
  for(const unit of ["个","套","樘","片","",undefined]) expect(directUnitValue(unit)).toBe(unit);
});
it("counts new prices and pictures consistently, once per product",()=>{
  expect(directChangeCounts(Array.from({length:15},()=>row("NEW",["salePrice","costPrice","产品图"])))).toEqual({prices:15,images:15});
});
it("counts only actual published updates, not skips, exclusions or unresolved rows",()=>{
  expect(directChangeCounts([row("UPDATE",["salePrice","costPrice"]),row("UPDATE",["产品图"]),row("UPDATE",["remarks"]),...(["SKIP","EXCLUDE","UNRESOLVED"] as const).map(state=>row(state,["salePrice","产品图"]))])).toEqual({prices:1,images:1});
});
