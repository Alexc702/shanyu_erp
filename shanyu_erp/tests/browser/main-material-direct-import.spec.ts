import { expect, test, type Page, type APIRequestContext, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import JSZip from "../../apps/api/node_modules/jszip";
import ExcelJS from "../../apps/api/node_modules/exceljs";

const api="http://localhost:4401";
const sourcePath="/Users/lulu/Downloads/新增瓷砖.xlsx";
// The checked original file is outside the app; the in-app reference is an exact controlled copy.
const referencePath=resolve("apps/api/assets/main-materials/import-reference.xlsx");
async function login(request:APIRequestContext,account="owner") { expect((await request.post(`${api}/auth/login`,{data:{identifier:account,password:"Shanyu123!",rememberMe:false}})).status()).toBe(200); }
async function captureBoth(page:Page,info:TestInfo,state:string){
  for(const width of [1440,1280]){
    await page.setViewportSize({width,height:width===1280 ? 720 : 1000});await page.evaluate(()=>window.scrollTo(0,0));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`${state}-${width}.png`),fullPage:true});
  }
}
async function information(page:Page) {
  const dialog=page.getByRole("dialog");
  const refreshed=page.waitForResponse(response=>response.url().endsWith("/preview")&&response.request().method()==="POST");
  await dialog.getByLabel("分类",{exact:true}).selectOption("TILE");
  await refreshed;
  await expect(dialog.getByRole("button",{name:"确认资料并校验"})).toBeEnabled();
  await expect(dialog.getByLabel("冠珠分组品名")).toBeVisible();
  await expect(dialog.getByLabel("计价单位",{exact:true}).locator("option")).toHaveText(["请选择","米（M）","平米（M²）","个","套","樘","片"]);
  await dialog.getByText("逐行确认（不同分类或品名时）",{exact:true}).click();
  await expect(dialog.getByLabel("第3行单位",{exact:true}).locator("option")).toHaveText(["请选择","米（M）","平米（M²）","个","套","樘","片"]);
  await dialog.getByLabel("第3行单位",{exact:true}).selectOption("M²");
  await dialog.getByText("逐行确认（不同分类或品名时）",{exact:true}).click();
  await dialog.getByLabel("计价单位",{exact:true}).selectOption("M²");
  await dialog.getByLabel("“价格/平方”的含义").selectOption("costPrice");
  await dialog.getByLabel("冠珠分组品名").selectOption("瓷砖");
  await dialog.getByLabel("德祥筑家分组品名").selectOption("瓷砖");
}
async function modified(price:number) {
  const zip=await JSZip.loadAsync(await readFile(referencePath)),xml=await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  zip.file("xl/worksheets/sheet1.xml",xml.replace(/(<c[^>]*r="H3"[^>]*>[\s\S]*?<v>)108(<\/v>)/,`$1${price}$2`));
  return zip.generateAsync({type:"nodebuffer"});
}
test("original fifteen products: information, real images, publication, details and selection persistence",async({page},testInfo)=>{
  await login(page.request); await page.setViewportSize({width:1440,height:1000});
  const old=(await (await page.request.get(`${api}/catalog/main-materials/published`)).json()).catalog;
  await page.goto("/catalog/import?type=main");await expect(page.getByRole("heading",{name:"导入主材",exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("14C-1440.png"),fullPage:true});
  await page.setViewportSize({width:1280,height:720});await page.screenshot({path:testInfo.outputPath("14C-1280.png"),fullPage:true});
  await page.getByLabel("客户 Excel 文件").setInputFiles(sourcePath);
  await expect(page.getByRole("dialog")).toBeVisible();await information(page);
  await expect(page.getByRole("dialog").getByText(/建议：瓷砖/)).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("14C-1-1280.png"),fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:testInfo.outputPath("14C-1-1440.png"),fullPage:true});
  const previewResponse=page.waitForResponse(response=>response.url().endsWith("/preview")&&response.request().method()==="POST");
  await page.getByRole("button",{name:"确认资料并校验",exact:true}).click();const previewUrl=(await previewResponse).url().replace(/\/preview$/,""),batch=(await(await page.request.get(previewUrl)).json()).batch;
  expect(batch.fileName).toBe("新增瓷砖.xlsx");expect(batch.counts.read).toBe(15);expect(batch.counts.unresolved).toBe(0);expect(batch.rows.every((row:{images:unknown[]})=>row.images.length===1)).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);await page.getByLabel("下一页",{exact:true}).click();await page.getByLabel("下一页",{exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:testInfo.outputPath("14D-1440.png"),fullPage:true});await page.setViewportSize({width:1280,height:720});await page.screenshot({path:testInfo.outputPath("14D-1280.png"),fullPage:true});
  await page.getByRole("button",{name:"查看详情",exact:true}).first().click();await captureBoth(page,testInfo,"14E-new");await page.getByRole("button",{name:"返回差异预览",exact:true}).click();
  await page.getByRole("button",{name:"图片核对",exact:true}).click();await expect(page.locator('img[alt="来源产品图"]')).toHaveCount(15);
  expect(await page.locator('img[alt="来源产品图"]').evaluateAll(nodes=>nodes.every(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0))).toBe(true);
  await page.screenshot({path:testInfo.outputPath("14D-1-1280.png"),fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:testInfo.outputPath("14D-1-1440.png"),fullPage:true});
  await page.getByRole("button",{name:"查看摘要并确认发布",exact:true}).click();await expect(page.getByRole("dialog").getByRole("button",{name:"确认发布",exact:true})).toBeEnabled();
  await expect(page.getByLabel("发布原因（选填）")).toHaveValue("");await page.screenshot({path:testInfo.outputPath("14F-1440.png"),fullPage:true});await page.setViewportSize({width:1280,height:720});await page.screenshot({path:testInfo.outputPath("14F-1280.png"),fullPage:true});
  // Delay transport only to inspect the busy state; the real server still publishes the batch.
  await page.route("**/direct-imports/*/publish",async route=>{await new Promise(resolve=>setTimeout(resolve,2500));await route.continue();});
  await page.getByRole("dialog").getByRole("button",{name:"确认发布",exact:true}).click();await expect(page.getByRole("dialog").getByRole("button",{name:"发布中…",exact:true})).toBeDisabled();await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toBeVisible();await captureBoth(page,testInfo,"14G-1-publishing");
  await expect(page.getByRole("heading",{name:"主材库发布成功"})).toBeVisible({timeout:60000});await page.unroute("**/direct-imports/*/publish");await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:testInfo.outputPath("14H-1280.png"),fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:testInfo.outputPath("14H-1440.png"),fullPage:true});
  const current=(await(await page.request.get(`${api}/catalog/main-materials/published`)).json()).catalog;expect(current.items.length).toBe(old.items.length+batch.counts.added);expect(current.versionNumber).toBe(old.versionNumber+1);
  for(const row of batch.rows){const item=current.items.find((item:{materialId:string})=>item.materialId===row.materialId); const photo=await page.request.get(`${api}${item.assets[0].path}`);expect(photo.status()).toBe(200);expect(createHash("sha256").update(await photo.body()).digest("hex")).toBe(row.images[0].visibleHash);}
  await expect(page.getByText("15 / 15",{exact:true})).toBeVisible();await expect(page.getByText("V1.16 原附件15款及裁剪图片隔离验收",{exact:true})).toHaveCount(0);
  await expect(page.getByRole("link",{name:"查看主材库",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"查看主材库",exact:true})).toHaveCount(0);
  let downloads=0;page.on("download",()=>downloads++);
  await page.getByRole("button",{name:"查看本次发布明细",exact:true}).click();await expect(page.getByRole("dialog").getByRole("heading",{name:"本次发布明细"})).toBeVisible();
  await expect(page.getByRole("dialog").getByText("瓷砖 · V1260301X",{exact:true})).toBeVisible();await expect(page.getByRole("dialog").getByText("108.00",{exact:true}).first()).toBeVisible();
  await captureBoth(page,testInfo,"published-details");expect(downloads).toBe(0);await page.getByRole("dialog").getByRole("button",{name:"关闭",exact:true}).first().click();
  await page.getByRole("button",{name:"继续导入",exact:true}).click();await page.getByLabel("客户 Excel 文件").setInputFiles(sourcePath);
  await expect(page.getByRole("heading",{name:"主材库发布成功"})).toHaveCount(0);await expect(page.getByRole("dialog")).toBeVisible();await information(page);
  await page.getByRole("dialog").getByRole("button",{name:"确认资料并校验"}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"查看摘要并确认发布"})).toBeDisabled();await captureBoth(page,testInfo,"published-file-reupload-no-change");
  expect((await(await page.request.get(`${api}/catalog/main-materials/published`)).json()).catalog.id).toBe(current.id);
  await page.goto("/catalog?type=main");await page.getByPlaceholder(/搜索/).last().fill("V1260301X");await expect(page.getByText("V1260301X",{exact:true}).first()).toBeVisible();
  const created=await page.request.post(`${api}/projects`,{data:{projectAddress:"V1.16 独立导入选型验收",customerName:"隔离客户",outerFrameArea:"100",leadDesignerId:"22222222-2222-4222-8222-222222222222",spaces:[{displayName:"客餐厅",type:"LIVING_DINING",area:"20",perimeter:"18",height:"2.8",includesBalcony:false}]}});expect(created.status()).toBe(201);const projectId=(await created.json()).project.id;
  const half=(await(await page.request.get(`${api}/projects/${projectId}/half-package-quotation`)).json()).quotation;
  const line=half.scopes.flatMap((scope:{lines:{itemName:string;id:string}[]})=>scope.lines).find((line:{itemName:string})=>/600\*1200mm地砖/.test(line.itemName));expect(line).toBeTruthy();
  expect((await page.request.patch(`${api}/projects/${projectId}/half-package-quotation/lines/${line.id}`,{data:{expectedRevision:half.revision,quantity:"2",selected:true}})).status()).toBe(200);
  await page.goto(`/projects/${projectId}/quotation/main-materials`);await page.getByRole("button",{name:"选择型号",exact:true}).first().click();await page.getByPlaceholder("搜索型号或名称").fill("V1260301X");await page.getByText("V1260301X",{exact:true}).first().click();await page.screenshot({path:testInfo.outputPath("selected-real-image.png"),fullPage:true});await page.getByRole("button",{name:"确认选择",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);await page.reload();await expect(page.getByText(/V1260301X/).first()).toBeVisible();
});

test("times real 15/50/100-row image imports, previews and confirmed publication",async({page},testInfo)=>{
  await login(page.request);
  const archive=await JSZip.loadAsync(await readFile(sourcePath)), pictures=await Promise.all(Object.keys(archive.files).filter(name=>/^xl\/media\//.test(name)&&/\.(png|jpe?g)$/i.test(name)).slice(0,15).map(async name=>({extension:/\.png$/i.test(name) ? "png" as const : "jpeg" as const,buffer:await archive.file(name)!.async("nodebuffer")})));
  expect(pictures.length).toBeGreaterThan(0);
  const measurements=[];
  for(const count of [15,50,100]) {
    const book=new ExcelJS.Workbook(), sheet=book.addWorksheet("性能验收资料");sheet.addRow(["分类","品名","品牌","型号","规格","单位","成本","售价","产品图"]);
    const ids=pictures.map(picture=>book.addImage(picture)), tag=crypto.randomUUID();
    for(let i=0;i<count;i++) {sheet.addRow(["瓷砖","瓷砖","冠珠",`BENCH-${tag}-${i*111}`,"600*1200","M²",65,108]);sheet.getRow(i+2).height=80;}
    for(let i=0;i<count;i++) sheet.addImage(ids[i%ids.length]!,{tl:{col:8,row:i+1},br:{col:9,row:i+2},editAs:"oneCell"});
    // ExcelJS emits a zero-sized picture transform; give this synthetic fixture an explicit valid shape.
    const fixture=await JSZip.loadAsync(Buffer.from(await book.xlsx.writeBuffer()));
    for(const name of Object.keys(fixture.files).filter(name=>/^xl\/drawings\/drawing\d+\.xml$/.test(name))) fixture.file(name,(await fixture.file(name)!.async("string")).replace(/<a:ext cx="0" cy="0"\s*\/>/g,'<a:ext cx="800" cy="800"/>'));
    const bytes=await fixture.generateAsync({type:"nodebuffer"}), before=(await(await page.request.get(`${api}/catalog/main-materials/published`)).json()).catalog;
    const start=performance.now(), response=await page.request.post(`${api}/catalog/main-materials/direct-imports`,{headers:{Accept:"application/x-ndjson","X-Import-Request-Id":crypto.randomUUID()},multipart:{file:{name:`${count}行验收.xlsx`,mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:bytes}}});
    expect(response.status()).toBe(201);const events=(await response.text()).trim().split("\n").map(line=>JSON.parse(line)), batch=events.at(-1)!.batch, uploadMs=performance.now()-start;
    expect(events.filter(event=>event.stage).map(event=>event.stage)).toEqual(expect.arrayContaining(["READING","IMAGES","VALIDATING"]));expect(batch.published).toBeNull();expect(batch.counts).toMatchObject({added:count,unresolved:0});expect(batch.rows.every((row:{images:unknown[]})=>row.images.length===1)).toBe(true);
    expect((await(await page.request.get(`${api}/catalog/main-materials/published`)).json()).catalog.id).toBe(before.id);
    const previewStart=performance.now(), preview=await page.request.post(`${api}/catalog/main-materials/direct-imports/${batch.id}/preview`,{data:{expectedRevision:batch.revision,information:batch.information}});expect(preview.status()).toBe(201);const ready=(await preview.json()).batch, previewMs=performance.now()-previewStart;
    const publishStart=performance.now(), published=await page.request.post(`${api}/catalog/main-materials/direct-imports/${batch.id}/publish`,{data:{expectedRevision:ready.revision,previewHash:ready.previewHash,confirmed:true,reason:`新增${count}款瓷砖`}});expect(published.status()).toBe(201);
    const result=(await published.json()).batch,publishMs=performance.now()-publishStart;expect(result.published.itemCount).toBe(before.items.length+count);
    measurements.push({rows:count,imageAssociations:count,distinctSourcePictures:pictures.length,fileBytes:bytes.length,uploadAndValidationMs:Math.round(uploadMs),repreviewMs:Math.round(previewMs),confirmedPublicationMs:Math.round(publishMs)});
  }
  await testInfo.attach("15-50-100-real-timings",{body:JSON.stringify(measurements,null,2),contentType:"application/json"});
  console.log("DIRECT_IMPORT_TIMINGS",JSON.stringify(measurements));
});
test("same SKU auto-update, final confirmation protection and concurrent idempotency",async({page},testInfo)=>{
  await login(page.request);await page.goto("/catalog/import?type=main");await page.getByLabel("客户 Excel 文件").setInputFiles({name:"同商品更正.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:await modified(109)});await information(page);
  const response=page.waitForResponse(response=>response.url().endsWith("/preview"));await page.getByRole("button",{name:"确认资料并校验"}).click();const batch=(await(await page.request.get((await response).url().replace(/\/preview$/,""))).json()).batch;expect(batch.counts).toMatchObject({added:0,updated:1,skipped:14,unresolved:0});
  await page.getByRole("button",{name:"查看详情",exact:true}).first().click();const detail=page.getByRole("region",{name:"商品差异与异常处理"});await expect(detail.getByText("108.00",{exact:true})).toBeVisible();await expect(detail.getByText("109.00",{exact:true})).toBeVisible();await captureBoth(page,testInfo,"14E-update");await page.getByRole("button",{name:"返回差异预览",exact:true}).click();
  const invalid=await page.request.post(`${api}/catalog/main-materials/direct-imports/${batch.id}/publish`,{data:{expectedRevision:batch.revision,previewHash:batch.previewHash,reason:"未确认",confirmed:false}});expect(invalid.status()).toBe(400);
  const data={expectedRevision:batch.revision,previewHash:batch.previewHash,reason:"并发更新验收",confirmed:true};const responses=await Promise.all([page.request.post(`${api}/catalog/main-materials/direct-imports/${batch.id}/publish`,{data}),page.request.post(`${api}/catalog/main-materials/direct-imports/${batch.id}/publish`,{data})]);
  expect(responses.map(response=>response.status())).toEqual([201,201]);const results=await Promise.all(responses.map(response=>response.json()));expect(results[0].batch.published.id).toBe(results[1].batch.published.id);
  await page.getByRole("button",{name:"查看摘要并确认发布",exact:true}).click();await page.getByLabel("发布原因（选填）").fill("调整瓷砖售价");await page.getByRole("dialog").getByRole("button",{name:"确认发布",exact:true}).click();
  await expect(page.getByRole("heading",{name:"主材库发布成功"})).toBeVisible();await expect(page.getByText("1 / 0",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"查看本次发布明细",exact:true}).click();await page.getByRole("dialog").getByText("查看前后差异",{exact:true}).click();await expect(page.getByRole("dialog").getByText("108.00 → 109.00",{exact:true})).toBeVisible();await captureBoth(page,testInfo,"published-update-details");
  const current=(await(await page.request.get(`${api}/catalog/main-materials/published`)).json()).catalog;expect(current.items.find((item:{model:string})=>item.model==="V1260301X").salePrice).toBe("109.00");
});
test("unsupported/corrupt states, controlled reference and unauthorized requests",async({page,browser},testInfo)=>{
  await login(page.request);await page.goto("/catalog/import?type=main");await page.getByLabel("客户 Excel 文件").setInputFiles({name:"坏文件.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from("bad")});await expect(page.getByRole("alert").filter({hasText:"本次未发布"})).toContainText("损坏");await expect(page.getByRole("button",{name:"下载参考模板"})).toHaveCount(0);await page.screenshot({path:testInfo.outputPath("14G-corrupt.png"),fullPage:true});
  await captureBoth(page,testInfo,"14G-corrupt");
  const zip=await JSZip.loadAsync(await readFile(referencePath));const book=await zip.file("xl/workbook.xml")!.async("string");zip.file("xl/workbook.xml",book.replace(/<sheets>[\s\S]*?<\/sheets>/,"<sheets/>") );await page.getByLabel("客户 Excel 文件").setInputFiles({name:"不支持.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:await zip.generateAsync({type:"nodebuffer"})});await expect(page.getByRole("button",{name:"下载参考模板"})).toBeVisible();await page.screenshot({path:testInfo.outputPath("14G-unsupported.png"),fullPage:true});
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"下载参考模板"}).click();const file=await download;expect(createHash("sha256").update(await readFile((await file.path())!)).digest("hex")).toBe(createHash("sha256").update(await readFile(referencePath)).digest("hex"));
  await captureBoth(page,testInfo,"14G-unsupported");
  const lead=await browser.newContext({baseURL:"http://localhost:4400"});try{await login(lead.request,"alex");expect((await lead.request.get(`${api}/catalog/main-materials/direct-imports/reference`)).status()).toBe(403);const page=await lead.newPage();await page.goto("/catalog/import?type=main");await expect(page).not.toHaveURL(/\/catalog\/import/);}finally{await lead.close();}
});
test("candidate sheets, duplicate resolution, zero prices, stale preview and no-change states",async({page,browser},testInfo)=>{
  await login(page.request);
  const book=new ExcelJS.Workbook(),headers=["分类","品名","品牌","型号","规格","单位","成本","售价"];
  for(const name of ["本次商品","其他商品"]){const sheet=book.addWorksheet(name);sheet.addRow(headers);sheet.addRow(["瓷砖","瓷砖","隔离验收品牌","SKU-101","600*1200","M²",0,0]);if(name==="本次商品"){sheet.addRow(["瓷砖","瓷砖","隔离验收品牌","SKU-101","600*1200","M²",1,0]);sheet.addRow(["瓷砖","瓷砖","隔离验收品牌","SKU-102","600*1200","M²",10,20]);}}
  await page.goto("/catalog/import?type=main");await page.getByLabel("客户 Excel 文件").setInputFiles({name:"多个商品表.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(await book.xlsx.writeBuffer())});
  const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();await page.screenshot({path:testInfo.outputPath("14C-2-1440.png"),fullPage:true});
  await page.setViewportSize({width:1280,height:720});await page.screenshot({path:testInfo.outputPath("14C-2-1280.png"),fullPage:true});
  const sheetResponse=page.waitForResponse(r=>r.url().endsWith("/preview"));await dialog.getByRole("radio").first().check();await sheetResponse;await expect(dialog.getByRole("button",{name:"确认资料并校验"})).toBeEnabled();
  await dialog.getByRole("button",{name:"确认资料并校验"}).click();await expect(dialog).toHaveCount(0);await page.getByRole("button",{name:"处理异常",exact:true}).first().click();
  await expect(page.getByRole("button",{name:"仅保留此行"})).toBeVisible();await captureBoth(page,testInfo,"14E-1");
  const resolved=page.waitForResponse(r=>r.url().endsWith("/preview"));await page.getByRole("button",{name:"仅保留此行"}).click();const url=(await resolved).url().replace(/\/preview$/,"");const batch=(await(await page.request.get(url)).json()).batch;
  expect(batch.counts).toMatchObject({read:3,added:2,excluded:1,unresolved:0});expect(batch.rows[0].values.costPrice).toBe("0");
  const lead=await browser.newContext();try{await login(lead.request,"alex");for(const endpoint of [url,`${url}/preview`,`${url}/publish`]){const response=endpoint===url?await lead.request.get(endpoint):await lead.request.post(endpoint,{data:{}});expect(response.status()).toBe(403);expect(await response.text()).not.toContain("SKU-101");}}finally{await lead.close();}
  const one=new ExcelJS.Workbook(),sheet=one.addWorksheet("商品");sheet.addRow(headers);sheet.addRow(["瓷砖","瓷砖","隔离验收品牌","SKU-103","600*1200","M²",5,10]);
  const incoming=await page.request.post(`${api}/catalog/main-materials/direct-imports`,{multipart:{file:{name:"并发商品.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(await one.xlsx.writeBuffer())}}});expect(incoming.status()).toBe(201);const parallel=(await incoming.json()).batch;
  expect((await page.request.post(`${api}/catalog/main-materials/direct-imports/${parallel.id}/publish`,{data:{expectedRevision:parallel.revision,previewHash:parallel.previewHash,confirmed:true,reason:"隔离并发基准变化验收"}})).status()).toBe(201);
  await page.getByRole("button",{name:"查看摘要并确认发布"}).click();await page.getByLabel("发布原因（选填）").fill("过期预览不能发布");await dialog.getByRole("button",{name:"确认发布",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"本次未发布"})).toContainText("基准");await page.screenshot({path:testInfo.outputPath("14G-stale.png"),fullPage:true});
  await captureBoth(page,testInfo,"14G-stale");
  const noChange=new ExcelJS.Workbook(),same=noChange.addWorksheet("商品");same.addRow(headers);same.addRow(["瓷砖","瓷砖","隔离验收品牌","SKU-103","600*1200","M²",5,10]);same.getCell("A1").font={bold:true};
  await page.getByRole("button",{name:"更换文件"}).click();await page.getByLabel("客户 Excel 文件").setInputFiles({name:"完全重复.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(await noChange.xlsx.writeBuffer())});
  await expect(page.getByText("本次无实际变化，不生成新版本。")).toBeVisible();await expect(page.getByRole("button",{name:"查看摘要并确认发布"})).toBeDisabled();await page.screenshot({path:testInfo.outputPath("14G-no-change.png"),fullPage:true});
  await captureBoth(page,testInfo,"14G-no-change");
});
