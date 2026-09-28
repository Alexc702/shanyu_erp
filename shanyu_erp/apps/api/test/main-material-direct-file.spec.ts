import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import sharp from "sharp";
import { readDirectMaterialFile, renderDirectImage, storeDirectFile, type XmlNode } from "../src/main-material/main-material-direct-file";
import { directUploadName } from "../src/main-material/main-material-direct.controller";

it("preserves Chinese multipart filenames and explicit image filenames",()=>{
  expect(directUploadName(Buffer.from("新增瓷砖.xlsx","utf8").toString("latin1"))).toBe("新增瓷砖.xlsx");
  expect(directUploadName("商品.png")).toBe("商品.png");expect(directUploadName("café.png")).toBe("café.png");
});
it("archives concurrent identical pictures atomically and rejects changed bytes",async()=>{
  const directory=await mkdtemp(resolve(tmpdir(),"direct-archive-test-")),path=resolve(directory,"same.png"),payload=Buffer.alloc(1024*1024,123);
  await Promise.all(Array.from({length:10},()=>storeDirectFile(path,payload)));expect((await readFile(path)).equals(payload)).toBe(true);
  await expect(storeDirectFile(path,Buffer.from("changed"))).rejects.toThrow("不一致");expect((await readFile(path)).equals(payload)).toBe(true);
},30_000);

it("reads the actual original file, without the historical sheet, and renders fifteen anchored pictures", async () => {
  const file = await readDirectMaterialFile(await readFile(resolve(process.cwd(), "assets/main-materials/import-reference.xlsx")));
  expect(file.sheets.map(s => s.name)).toEqual(["Sheet2"]);
  const sheet = file.sheets[0]!;
  expect(sheet.rows).toHaveLength(15);
  expect(sheet.rows.every(r => r.images.length === 1)).toBe(true);
  expect(sheet.rows[0]!.values).toMatchObject({ brand: "冠珠", model: "V1260301X", ambiguousPrice: "65", salePrice: "108" });
  for (const row of sheet.rows.filter(r => r.row >= 13)) {
    expect(row.images[0]!.transform.crop).not.toEqual([0, 0, 0, 0]);
    expect(row.images[0]!.originalHash).not.toBe(row.images[0]!.visibleHash);
  }
},60_000);

async function workbook(rows: unknown[][], header = ["型号","规格","售价","品牌","成本","图片"], sheetName="任意商品表") {
  const book=new ExcelJS.Workbook(), sheet=book.addWorksheet(sheetName); sheet.addRow(["说明不入库"]); sheet.addRow([]); sheet.addRow(header); rows.forEach(row=>sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
}
it("recognizes alternate columns/header positions and ignores unrelated instructions",async()=>{
  const file=await readDirectMaterialFile(await workbook([["001-02","600×1200",100,"品牌",60]], ["产品型号","尺寸","销售价","品牌","采购价","产品图"]));
  expect(file.sheets[0]!.headerRow).toBe(3);expect(file.sheets[0]!.rows[0]!.values.model).toBe("001-02");expect(file.sheets[0]!.rows).toHaveLength(1);
});
it("distinguishes damaged bytes from an unsupported valid workbook",async()=>{
  await expect(readDirectMaterialFile(Buffer.from("bad"))).rejects.toMatchObject({kind:"CORRUPT"});
  const book=new ExcelJS.Workbook();book.addWorksheet("说明").addRow(["不是商品表"]);
  await expect(readDirectMaterialFile(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toMatchObject({kind:"UNSUPPORTED"});
});
it("reads cached formulas only, with precise cell errors for missing/invalid caches",async()=>{
  const file=await readDirectMaterialFile(await workbook([["A","600*1200",{formula:"40+60",result:100},"品牌",60],["B","600*1200",{formula:"1+2"},"品牌",60],["C","600*1200",{error:"#VALUE!"},"品牌",60]]));
  expect(file.sheets[0]!.rows[0]!.values.salePrice).toBe("100"); expect(file.sheets[0]!.rows[1]!.issues.join()).toContain("C5");expect(file.sheets[0]!.rows[2]!.issues.join()).toContain("#VALUE!");
});
it("does not silently concatenate multiple candidate sheets",async()=>{
  const book=new ExcelJS.Workbook(); for(const name of ["商品甲","商品乙"]){const sheet=book.addWorksheet(name);sheet.addRow(["型号","规格","售价","品牌"]);sheet.addRow([name,"10*20",10,"品牌"]);}
  const file=await readDirectMaterialFile(Buffer.from(await book.xlsx.writeBuffer()));expect(file.sheets.map(sheet=>sheet.name)).toEqual(["商品甲","商品乙"]);
});
it("binds explicit image filenames and blocks same-name ambiguity or unreadable data",async()=>{
  const png=await sharp({create:{width:20,height:10,channels:3,background:"red"}}).png().toBuffer(), file=await workbook([["A","600*1200",100,"品牌",60,"A.png"]]);
  expect((await readDirectMaterialFile(file,[{name:"A.png",buffer:png}])).sheets[0]!.rows[0]!.images).toHaveLength(1);
  expect((await readDirectMaterialFile(file,[{name:"A.png",buffer:png},{name:"A.png",buffer:png}])).sheets[0]!.rows[0]!.issues.join()).toContain("歧义");
  expect((await readDirectMaterialFile(file,[{name:"A.png",buffer:Buffer.from("bad")}])).sheets[0]!.rows[0]!.issues).toHaveLength(1);
});
it("restores crop/stretch/flip/rotate order and preserves distinct visible crops",async()=>{
  const raw=Buffer.alloc(40*20*3);for(let y=0;y<20;y++)for(let x=0;x<40;x++){const start=(y*40+x)*3;raw[start]=x<20?255:0;raw[start+1]=x>=20?255:0;}
  const png=await sharp(raw,{raw:{width:40,height:20,channels:3}}).png().toBuffer();
  const pic:XmlNode={name:"pic",text:"",attrs:{},children:[{name:"srcRect",text:"",attrs:{l:"0",r:"50000"},children:[]},{name:"xfrm",text:"",attrs:{rot:"5400000",flipH:"1"},children:[{name:"ext",text:"",attrs:{cx:"40",cy:"20"},children:[]}]}]};
  const first=await renderDirectImage(png,pic,"row1"), second=await renderDirectImage(png,{...pic,children:[{...pic.children[0]!,attrs:{l:"50000",r:"0"}},pic.children[1]!] },"row2");
  expect(first.originalHash).toBe(second.originalHash);expect(first.visibleHash).not.toBe(second.visibleHash);expect(await sharp(Buffer.from(first.visible,"base64")).metadata()).toMatchObject({width:20,height:40});
});
it("preserves original reference download bytes and rejects image cross-row anchors",async()=>{
  const original=await readFile(resolve(process.cwd(),"assets/main-materials/import-reference.xlsx")),zip=await JSZip.loadAsync(original);
  const xml=await zip.file("xl/drawings/drawing1.xml")!.async("string");
  zip.file("xl/drawings/drawing1.xml",xml.replace(/<xdr:to>([\s\S]*?)<xdr:row>2<\/xdr:row>/,"<xdr:to>$1<xdr:row>4</xdr:row>"));
  const file=await readDirectMaterialFile(await zip.generateAsync({type:"nodebuffer"}));expect(file.sheets[0]!.rows[0]!.issues.join()).toContain("跨行");
},60_000);
it("preserves explicit numeric model display with leading zero format",async()=>{
  const book=new ExcelJS.Workbook(), sheet=book.addWorksheet("SKU");sheet.addRow(["型号","规格","售价","品牌"]);sheet.addRow([12,"600*1200",100,"品牌"]);sheet.getCell("A2").numFmt="00000";
  expect((await readDirectMaterialFile(Buffer.from(await book.xlsx.writeBuffer()))).sheets[0]!.rows[0]!.values.model).toBe("00012");
});
it("reads an explicitly related WPS cell picture without executing DISPIMG",async()=>{
  const file=await workbook([["A","600*1200",100,"品牌",60,{formula:'_xlfn.DISPIMG("PIC-A",1)',result:"图片"}]]),zip=await JSZip.loadAsync(file);
  const png=await sharp({create:{width:30,height:20,channels:3,background:"blue"}}).png().toBuffer();
  zip.file("xl/cellimages.xml",'<etc:cellImages xmlns:etc="http://example.test" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><etc:cellImage><etc:pic><etc:cNvPr name="PIC-A"/><a:blip r:embed="rId1"/></etc:pic></etc:cellImage></etc:cellImages>');
  zip.file("xl/_rels/cellimages.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="media/wps.png" Type="image"/></Relationships>');zip.file("xl/media/wps.png",png);
  const source=await readDirectMaterialFile(await zip.generateAsync({type:"nodebuffer"}));expect(source.sheets[0]!.rows[0]!.images).toHaveLength(1);expect(source.sheets[0]!.rows[0]!.issues).toEqual([]);
  const xml=await zip.file("xl/worksheets/sheet1.xml")!.async("string");zip.file("xl/worksheets/sheet1.xml",xml.replace(/<c[^>]*r="F3"[^>]*>[\s\S]*?<\/c>/,""));
  expect((await readDirectMaterialFile(await zip.generateAsync({type:"nodebuffer"}))).sheets[0]!.rows[0]!.images).toHaveLength(1);
  const pictures=await zip.file("xl/cellimages.xml")!.async("string");zip.file("xl/cellimages.xml",pictures.replace("</etc:cellImages>",'<etc:cellImage><etc:pic><etc:cNvPr name="PIC-A"/><a:blip r:embed="rId1"/></etc:pic></etc:cellImage></etc:cellImages>'));
  expect((await readDirectMaterialFile(await zip.generateAsync({type:"nodebuffer"}))).sheets[0]!.rows[0]!.issues.join()).toContain("同名歧义");
});
