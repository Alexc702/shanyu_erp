import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readMainMaterialXlsx } from "../src/main-material/main-material-xlsx-reader";

describe("main material XLSX values reader", () => {
  it("reads prefixed OOXML, shared/rich/inline text and cached formulas without parsing presentation tables", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("主材库");
    sheet.getCell("A1").value = { richText: [{ text: "型号" }, { text: " & 名称" }] };
    sheet.getCell("B2").value = { formula: "1+1", result: 2 };
    const zip = await JSZip.loadAsync(await book.xlsx.writeBuffer());
    for (const path of ["xl/workbook.xml", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"]) {
      const xml = await zip.file(path)!.async("string");
      zip.file(path, xml.replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g, "<$1x:$2")
        .replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));
    }
    // Presentation-only table XML is deliberately not an import dependency.
    zip.file("xl/tables/table1.xml", "<unsupported-table/>");
    const read = await readMainMaterialXlsx(await zip.generateAsync({ type: "nodebuffer" }));
    expect(read.getWorksheet("主材库")!.getCell("A1").text).toBe("型号 & 名称");
    expect(read.getWorksheet("主材库")!.getCell("B2").text).toBe("2");
  });

  it("distinguishes a damaged archive from an incompatible workbook structure", async () => {
    await expect(readMainMaterialXlsx(Buffer.from("not zip"))).rejects.toThrow("压缩包");
    const zip = new JSZip().file("other.xml", "<other/>");
    await expect(readMainMaterialXlsx(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow("结构不兼容");
  });
});
