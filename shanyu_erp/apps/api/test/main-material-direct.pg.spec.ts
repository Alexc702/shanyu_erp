import { readFile, writeFile, mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DirectMaterialBatchView, SessionUser } from "@shanyu/contracts";
import { AccessPolicy } from "../src/access/access.policy";
import type { DatabaseClient, DatabaseExecutor } from "../src/database/database.client";
import { MainMaterialDirectService, directStorageRoot } from "../src/main-material/main-material-direct.service";
import { PgMainMaterialRepository } from "../src/main-material/pg-main-material.repository";

describe.skipIf(process.env.SHANYU_SAFE_UPDATE_DB_TEST !== "1")("direct publication / isolated PostgreSQL", { timeout: 60_000 }, () => {
  let pool: Pool, client: PoolClient, service: MainMaterialDirectService, repository: PgMainMaterialRepository, source: Buffer, actor: SessionUser;
  beforeAll(async () => {
    if (process.env.POSTGRES_HOST !== "127.0.0.1" || process.env.POSTGRES_DB !== "shanyu_catalog_safe_test" || process.env.POSTGRES_PORT !== "55449") throw new Error("Only the explicit task-isolated database is allowed");
    pool=new Pool({host:process.env.POSTGRES_HOST,port:Number(process.env.POSTGRES_PORT),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
    process.env.MAIN_MATERIAL_IMPORT_STORAGE_DIR=await mkdtemp(resolve(tmpdir(),"shanyu-direct-pg-"));
    source=await readFile(resolve(process.cwd(),"assets/main-materials/import-reference.xlsx"));
    actor={id:"11111111-1111-4111-8111-111111111111",account:"owner",displayName:"何总",role:"OWNER",phone:null};
  });
  afterAll(async () => { await pool?.end(); });
  beforeEach(async () => {
    client=await pool.connect(); await client.query("BEGIN");
    const database={query:(sql:string,values?:readonly unknown[])=>client.query(sql,values ? [...values]:[]), transaction:async <T>(work:(db:DatabaseExecutor)=>Promise<T>)=> {
      await client.query("SAVEPOINT direct_operation"); try { const result=await work(database); await client.query("RELEASE SAVEPOINT direct_operation"); return result; } catch(error) { await client.query("ROLLBACK TO SAVEPOINT direct_operation"); throw error; }
    }} as DatabaseClient;
    repository=new PgMainMaterialRepository(database); service=new MainMaterialDirectService(new AccessPolicy(),database,repository);
  });
  afterEach(async () => {await client.query("ROLLBACK");client.release();});
  async function ready() {
    const upload=await service.upload(actor,{name:"新增瓷砖.xlsx",buffer:source});
    return service.repreview(actor,upload.id,{expectedRevision:upload.revision,information:{categoryCode:"TILE",unit:"M²",ambiguousPriceMeaning:"costPrice",rows:Object.fromEntries(upload.rows.map(row=>[row.row,{itemName:"瓷砖"}]))}});
  }
  function confirmation(batch:DirectMaterialBatchView){return {expectedRevision:batch.revision,previewHash:batch.previewHash,reason:"隔离本地真实附件验收",confirmed:true};}
  async function state(){return JSON.stringify((await client.query(`SELECT 'projects' AS source,jsonb_agg(to_jsonb(p) ORDER BY id) AS data FROM projects p UNION ALL
    SELECT 'quotations',jsonb_agg(to_jsonb(q) ORDER BY id) FROM half_package_quotations q UNION ALL
    SELECT 'material-lines',jsonb_agg(to_jsonb(l) ORDER BY id) FROM main_material_quote_lines l`)).rows);}
  it("uploads without publication, reuses exact files and confirms only legal names",async()=>{
    const before=(await repository.getPublishedCatalog())!, one=await service.upload(actor,{name:"原.xlsx",buffer:source}), two=await service.upload(actor,{name:"改名.xlsx",buffer:source});
    expect(one.id).toBe(two.id); expect(one.counts).toMatchObject({read:15,unresolved:15}); expect(one.needsInformation).toBe(true);
    expect((await repository.getPublishedCatalog())!.id).toBe(before.id);
    const invalid=await service.repreview(actor,one.id,{expectedRevision:one.revision,information:{categoryCode:"TILE",unit:"M²",ambiguousPriceMeaning:"costPrice",rows:{3:{itemName:"不存在的品名"}}}});
    expect(invalid.canPublish).toBe(false); await expect(service.publish(actor,invalid.id,confirmation(invalid))).rejects.toThrow();
  });
  it("publishes 15 persistent real pictures atomically, preserving old library and project snapshots",async()=>{
    const before=(await repository.getPublishedCatalog())!, snapshots=await state(), batch=await ready();
    expect(batch.canPublish).toBe(true); const next=await service.publish(actor,batch.id,confirmation(batch)), current=(await repository.getPublishedCatalog())!;
    expect(next.published?.itemCount).toBe(before.items.length+batch.counts.added); expect(current.items).toHaveLength(before.items.length+15);
    expect(await state()).toBe(snapshots); expect(await repository.getCatalogById(before.id)).toEqual(before);
    for(const original of before.items){const item=current.items.find(item=>item.materialId===original.materialId)!; expect({...item,id:original.id,catalogVersionId:original.catalogVersionId}).toEqual(original);}
    for(const row of batch.rows){const item=current.items.find(item=>item.materialId===row.materialId)!; expect(item.assetIds).toEqual([row.images[0]!.visibleHash]); const asset=await repository.findAsset(item.assetIds[0]!);expect((await readFile(resolve(process.cwd(),"assets",asset!.storagePath))).equals(Buffer.from(row.images[0]!.url.split(",")[1]!,"base64"))).toBe(true);}
    expect((await service.publish(actor,batch.id,confirmation(batch))).published?.id).toBe(next.published?.id);
  },60_000);
  it("requires final confirmation, zero unresolved and current revision",async()=>{
    const batch=await ready();
    for(const body of [{...confirmation(batch),confirmed:false},{...confirmation(batch),reason:123},{...confirmation(batch),expectedRevision:0}]) await expect(service.publish(actor,batch.id,body)).rejects.toThrow();
    const next=await service.repreview(actor,batch.id,{expectedRevision:batch.revision,information:{...batch.information,rows:{...batch.information.rows,3:{itemName:"瓷砖",decision:"EXCLUDE"}}}});
    expect(next.previewHash).not.toBe(batch.previewHash);await expect(service.publish(actor,batch.id,confirmation(batch))).rejects.toThrow("失效");
    await expect(service.repreview(actor,next.id,{expectedRevision:batch.revision,information:batch.information})).rejects.toThrow("改变");
  });
  it.each([undefined,"","   "," 新增瓷砖资料 "])("publishes with optional reason %j and retains the actor, time, batch and changes in audit",async(reason)=>{
    const batch=await ready(), before=await state();
    const result=await service.publish(actor,batch.id,{...confirmation(batch),reason});
    const expectedReason=reason?.trim() || "主材库导入发布";
    expect(result.published?.reason).toBe(expectedReason);
    const audit=(await client.query("SELECT * FROM audit_events WHERE action='MAIN_MATERIAL_DIRECT_IMPORT_PUBLISHED' AND target_id=$1",[result.published!.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({actor_user_id:actor.id,result:"SUCCESS",reason:expectedReason,metadata:{batchId:batch.id,previewHash:batch.previewHash,changedIds:batch.rows.map(row=>row.materialId)}});
    expect(audit[0].occurred_at).toBeTruthy();expect(await state()).toBe(before);
    await service.publish(actor,batch.id,{...confirmation(batch),reason});
    expect((await client.query("SELECT id FROM audit_events WHERE action='MAIN_MATERIAL_DIRECT_IMPORT_PUBLISHED' AND target_id=$1",[result.published!.id])).rows).toHaveLength(1);
  });
  it("reuploads published files as fresh previews, but retries one upload operation idempotently",async()=>{
    const operation=crypto.randomUUID(), first=await service.upload(actor,{name:"新增瓷砖.xlsx",buffer:source},[],operation);
    const ready=await service.repreview(actor,first.id,{expectedRevision:first.revision,information:{categoryCode:"TILE",unit:"M²",ambiguousPriceMeaning:"costPrice",rows:Object.fromEntries(first.rows.map(row=>[row.row,{itemName:"瓷砖"}]))}});
    const published=await service.publish(actor,ready.id,confirmation(ready));
    expect((await service.upload(actor,{name:"新增瓷砖.xlsx",buffer:source},[],operation)).published?.id).toBe(published.published?.id);
    const fresh=await service.upload(actor,{name:"新增瓷砖.xlsx",buffer:source},[],crypto.randomUUID());
    expect(fresh.id).not.toBe(first.id);expect(fresh.published).toBeNull();expect(fresh.baseCatalogId).toBe(published.published?.id);
    const repeat=await service.repreview(actor,fresh.id,{expectedRevision:fresh.revision,information:ready.information});
    expect(repeat.counts).toMatchObject({skipped:15,added:0,updated:0});expect(repeat.canPublish).toBe(false);
    await expect(service.publish(actor,repeat.id,confirmation(repeat))).rejects.toThrow("无实际变化");
    const legacy=await service.upload(actor,{name:"旧客户端.xlsx",buffer:source});expect(legacy.published).toBeNull();
    expect((await repository.getPublishedCatalog())!.id).toBe(published.published?.id);
  });
  it("reports real file, image and validation phases without publishing on upload",async()=>{
    const stages:string[]=[], before=(await repository.getPublishedCatalog())!.id;
    const batch=await service.upload(actor,{name:"新增瓷砖.xlsx",buffer:source},[],crypto.randomUUID(),stage=>stages.push(stage));
    expect(stages[0]).toBe("READING");expect(stages).toContain("IMAGES");expect(stages.at(-1)).toBe("VALIDATING");
    expect(batch.published).toBeNull();expect((await repository.getPublishedCatalog())!.id).toBe(before);
    await expect(service.upload(actor,{name:"新增瓷砖.xlsx",buffer:source},[],"invalid")).rejects.toThrow("标识");
  });
  it("rejects stale catalog and record versions without partially publishing",async()=>{
    const batch=await ready(), before=(await repository.getPublishedCatalog())!;
    const first=before.items[0]!;
    const delta=await repository.createImportBatch({id:crypto.randomUUID(),createdByUserId:actor.id,fileName:"并发更新",fileHash:crypto.randomUUID(),mode:"DELTA",status:"VALIDATED",validation:{blockerCount:0},payload:[{operation:"UPSERT",materialId:first.materialId,expectedRecordVersion:first.recordVersion,changeReason:"隔离并发测试",values:{remarks:"更新说明"}}]});
    await repository.publishImportBatch(delta.id,actor.id);
    await expect(service.publish(actor,batch.id,confirmation(batch))).rejects.toThrow("基准");
    expect((await repository.getPublishedCatalog())!.versionNumber).toBe(before.versionNumber+1);
  });
  it("rolls back every write if an archived image is altered",async()=>{
    const batch=await ready(), before=(await repository.getPublishedCatalog())!, path=resolve(directStorageRoot(),`${batch.rows[0]!.images[0]!.visibleHash}.png`), bytes=await readFile(path);
    try{await writeFile(path,"invalid");await expect(service.publish(actor,batch.id,confirmation(batch))).rejects.toThrow();expect((await repository.getPublishedCatalog())!.id).toBe(before.id);}finally{await writeFile(path,bytes);}
  });
  it("cannot bypass final confirmation through the legacy publication API",async()=>{
    const batch=await ready();await service.publish(actor,batch.id,confirmation(batch));
    await expect(repository.publishImportBatch(batch.id,actor.id)).rejects.toThrow("最终确认");
  });
  it("does not create a version when every row is excluded",async()=>{
    const batch=await ready(), next=await service.repreview(actor,batch.id,{expectedRevision:batch.revision,information:{...batch.information,rows:Object.fromEntries(batch.rows.map(row=>[row.row,{decision:"EXCLUDE"}]))}});
    expect(next.counts.excluded).toBe(15);expect(next.canPublish).toBe(false); await expect(service.publish(actor,next.id,confirmation(next))).rejects.toThrow("无实际变化");
  });
  it("checks management permission before reading the workbook, costs or reference",async()=>{
    const lead={...actor,role:"LEAD_DESIGNER" as const};
    await expect(service.upload(lead,{name:"坏.xlsx",buffer:Buffer.from("bad")})).rejects.toThrow();await expect(service.reference(lead)).rejects.toThrow(); await expect(service.get(lead,"missing")).rejects.toThrow();
  });
  it("rechecks current actor role inside publication transaction",async()=>{
    const batch=await ready();await client.query("UPDATE users SET role='LEAD_DESIGNER' WHERE id=$1",[actor.id]);
    await expect(service.publish(actor,batch.id,confirmation(batch))).rejects.toThrow("权限");
  });
  it("rolls back inserted assets and versions on a transaction-level failure",async()=>{
    const batch=await ready(), before=(await repository.getPublishedCatalog())!, assets=(await client.query("SELECT count(*) FROM main_material_assets")).rows;
    await client.query("CREATE FUNCTION direct_test_reject_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated publication failure'; END $$");
    await client.query("CREATE TRIGGER direct_test_reject_version BEFORE INSERT ON main_material_catalog_versions FOR EACH ROW EXECUTE FUNCTION direct_test_reject_version()");
    await expect(service.publish(actor,batch.id,confirmation(batch))).rejects.toThrow("isolated publication failure");
    expect((await repository.getPublishedCatalog())!.id).toBe(before.id);expect((await client.query("SELECT count(*) FROM main_material_assets")).rows).toEqual(assets);
  });
  it("rejects altered original workbook archives and preserves a completed preview",async()=>{
    const batch=await ready(), archive=(await client.query<{batch_key:string}>("SELECT batch_key FROM direct_material_imports WHERE id=$1",[batch.id])).rows[0]!,path=resolve(directStorageRoot(),`${archive.batch_key}.xlsx`),bytes=await readFile(path);
    try{await writeFile(path,"altered");await expect(service.publish(actor,batch.id,confirmation(batch))).rejects.toThrow("归档");}finally{await writeFile(path,bytes);}
    await service.publish(actor,batch.id,confirmation(batch));
    await expect(service.repreview(actor,batch.id,{expectedRevision:batch.revision,information:batch.information})).rejects.toThrow("已发布");
  });
  it("restores archived files and published images after cache loss without using the read-only export volume",async()=>{
    const batch=await ready(),photo=batch.rows[0]!.images[0]!, privatePath=resolve(directStorageRoot(),`${photo.visibleHash}.png`);
    await unlink(privatePath);expect((await service.get(actor,batch.id)).rows[0]!.images[0]!.url).toBe(photo.url);
    await service.publish(actor,batch.id,confirmation(batch));
    const asset=await repository.findAsset(photo.visibleHash), publicPath=resolve(process.cwd(),"assets",asset!.storagePath);await unlink(publicPath);
    const restored=await repository.findAsset(photo.visibleHash);expect(restored!.storagePath).toBe(`main-materials/imported/${photo.visibleHash}.png`);
    expect((await readFile(publicPath)).equals(Buffer.from(photo.url.split(",")[1]!,"base64"))).toBe(true);
    const configured=process.env.MAIN_MATERIAL_IMPORT_STORAGE_DIR;delete process.env.MAIN_MATERIAL_IMPORT_STORAGE_DIR;
    try{expect(directStorageRoot()).not.toContain(process.env.EXPORT_STORAGE_DIR ?? "quotation_exports");}finally{process.env.MAIN_MATERIAL_IMPORT_STORAGE_DIR=configured;}
  });
});
