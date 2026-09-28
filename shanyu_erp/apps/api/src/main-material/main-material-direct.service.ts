import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { DirectMaterialBatchView, DirectMaterialInformation, DirectMaterialProcessingStage, SessionUser } from "@shanyu/contracts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { AccessPolicy } from "../access/access.policy";
import { DatabaseClient } from "../database/database.client";
import { cacheDirectAsset, DirectFileError, hash, readDirectMaterialFile, storeDirectFile, type DirectSource } from "./main-material-direct-file";
import { directNameOptions, makeDirectPlan, type DirectPlan } from "./main-material-direct-plan";
import { PgMainMaterialRepository } from "./pg-main-material.repository";
import type { MainMaterialItem } from "./main-material.repository";

interface StoredPreview { baseCatalogId: string | null; baseVersion: number; currentCount: number; plan: DirectPlan }
interface DirectRow { id: string; file_name: string; source: DirectSource; information: DirectMaterialInformation; revision: number; preview_hash: string; preview: StoredPreview; [key: string]: unknown }
export interface DirectPublication {
  baseCatalogId: string | null; previewHash: string; reason: string;
  changes: DirectPlan["changes"];
  sourceArchive: { path: string; hash: string };
  assets: { id: string; storagePath: string; cachedPath: string; size: number; originalPath: string; originalHash: string }[];
}
export function directStorageRoot(): string {
  return resolve(process.env.MAIN_MATERIAL_IMPORT_STORAGE_DIR ?? resolve(tmpdir(),"shanyu-material-import"), "direct-imports");
}
const imagePath = (id: string, original = false) => resolve(directStorageRoot(), `${id}.${original ? "original" : "png"}`);

@Injectable()
export class MainMaterialDirectService {
  constructor(private readonly access: AccessPolicy, private readonly database: DatabaseClient, private readonly repository: PgMainMaterialRepository) {}

  async reference(actor: SessionUser): Promise<Buffer> {
    this.access.assertCanManageCatalog(actor);
    for (const path of [resolve(process.cwd(), "assets/main-materials/import-reference.xlsx"), resolve(process.cwd(), "apps/api/assets/main-materials/import-reference.xlsx")]) {
      try { return await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    throw new NotFoundException("参考文件暂不可用");
  }
  async upload(actor: SessionUser, file: { name: string; buffer: Buffer }, images: readonly { name: string; buffer: Buffer }[] = [], requestId?: string, progress?: (stage: DirectMaterialProcessingStage) => void): Promise<DirectMaterialBatchView> {
    this.access.assertCanManageCatalog(actor);
    if (!/\.xlsx$/i.test(file.name)) throw new BadRequestException({ message: "仅支持可正常打开的 .xlsx 文件", kind: "CORRUPT" });
    if (requestId !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) throw new BadRequestException("上传请求标识无效");
    // A new user operation gets a new batch; retries of that operation remain idempotent.
    // Older clients without an operation ID only reuse previews against the same current library.
    const scope = requestId ?? (await this.repository.getPublishedCatalog())?.id ?? "empty";
    const key = hash(JSON.stringify(["direct-xlsx-v1.16-operation", actor.id, scope, hash(file.buffer), images.map(i => [i.name, hash(i.buffer)]).sort()]));
    const existing = await this.database.query<DirectRow>("SELECT * FROM direct_material_imports WHERE batch_key=$1", [key]);
    if (existing.rows[0]) { progress?.("VALIDATING"); return this.view(existing.rows[0]); }
    let source: DirectSource;
    try { source = await readDirectMaterialFile(file.buffer, images, progress); }
    catch (error) { throw new BadRequestException({ message: error instanceof Error ? error.message : "文件读取失败", kind: error instanceof DirectFileError ? error.kind : "CORRUPT" }); }
    await mkdir(directStorageRoot(), { recursive: true, mode: 0o750 });
    await this.archive(resolve(directStorageRoot(), `${key}.xlsx`), file.buffer);
    for (const sheet of source.sheets) for (const row of sheet.rows) for (const image of row.images) {
      await this.archive(imagePath(image.originalHash, true), Buffer.from(image.original, "base64"));
      await this.archive(imagePath(image.visibleHash), Buffer.from(image.visible, "base64"));
      image.original = ""; image.visible = "";
    }
    progress?.("VALIDATING");
    const id = randomUUID(), information = {}, preview = await this.preview(source, information), previewHash = this.planHash(source, information, preview);
    await this.database.query(`INSERT INTO direct_material_imports(id,batch_key,file_name,source,information,preview_hash,preview,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(batch_key) DO NOTHING`, [id, key, file.name, source, information, previewHash, preview, actor.id]);
    const saved = await this.database.query<DirectRow>("SELECT * FROM direct_material_imports WHERE batch_key=$1", [key]);
    return this.view(saved.rows[0]!);
  }
  async get(actor: SessionUser, id: string) { this.access.assertCanManageCatalog(actor); return this.view(await this.find(id)); }
  async repreview(actor: SessionUser, id: string, input: unknown): Promise<DirectMaterialBatchView> {
    this.access.assertCanManageCatalog(actor);
    const body = record(input);
    if (!Number.isSafeInteger(body.expectedRevision)) throw new BadRequestException("预览修订号无效");
    const information = validatedInformation(body.information);
    const saved = await this.find(id);
    if (await this.published(saved)) throw new ConflictException("本批次已发布，请重新选择文件开始新批次");
    const preview = await this.preview(saved.source, information), previewHash = this.planHash(saved.source, information, preview);
    const result = await this.database.transaction(async database => {
      await database.query("SELECT id FROM direct_material_imports WHERE id=$1 FOR UPDATE",[id]);
      const status = await database.query<{status:string}>("SELECT status FROM main_material_import_batches WHERE id=$1",[id]);
      if (status.rows[0]?.status === "PUBLISHED") throw new ConflictException("本批次已发布，不能改变已确认资料");
      return database.query<DirectRow>(`UPDATE direct_material_imports SET information=$2,revision=revision+1,preview=$3,preview_hash=$4
        WHERE id=$1 AND revision=$5 RETURNING *`, [id, information, preview, previewHash, body.expectedRevision]);
    });
    if (!result.rows[0]) throw new ConflictException("资料或处理决定已改变，请重新读取预览");
    return this.view(result.rows[0]);
  }
  async publish(actor: SessionUser, id: string, input: unknown): Promise<DirectMaterialBatchView> {
    this.access.assertCanManageCatalog(actor);
    const body = record(input), saved = await this.find(id);
    if (body.confirmed !== true) throw new BadRequestException("请复核发布摘要，确认后才可发布");
    if (body.reason !== undefined && typeof body.reason !== "string") throw new BadRequestException("发布原因须为文字");
    if (body.previewHash !== saved.preview_hash || body.expectedRevision !== saved.revision) throw new ConflictException("预览已失效，请重新校验并确认");
    if (await this.published(saved)) return this.view(saved);
    const preview = await this.preview(saved.source, saved.information);
    if (this.planHash(saved.source, saved.information, preview) !== saved.preview_hash) throw new ConflictException("基准主材库或资产已变化，请重新校验并查看最新差异");
    if (preview.plan.needsInformation || preview.plan.counts.unresolved || !preview.plan.changes.length) throw new BadRequestException("未解决资料/问题或本次无实际变化，不能发布");
    const assets: DirectPublication["assets"] = [];
    for (const row of preview.plan.rows.filter(r => ["NEW", "UPDATE"].includes(r.result))) for (const image of row.images) {
      const payload = await this.archived(imagePath(image.visibleHash),image.visibleHash);
      if (hash(payload) !== image.visibleHash || hash(await this.archived(imagePath(image.originalHash, true),image.originalHash)) !== image.originalHash) throw new ConflictException("图片已变化或不可读，请重新上传并预览");
      assets.push({ id: image.visibleHash, storagePath:await cacheDirectAsset(image.visibleHash,payload), cachedPath:imagePath(image.visibleHash), size: payload.length, originalPath: imagePath(image.originalHash,true), originalHash:image.originalHash });
    }
    const archivePath=resolve(directStorageRoot(),`${saved.batch_key}.xlsx`);await this.archived(archivePath,saved.source.fileHash);
    const publication: DirectPublication = { ...preview, changes: preview.plan.changes, previewHash: saved.preview_hash, reason: typeof body.reason === "string" && body.reason.trim() || "主材库导入发布", assets, sourceArchive:{path:archivePath,hash:saved.source.fileHash} };
    const legacyId = id;
    // Same UUID and preview-bound hash make concurrent/repeated requests converge.
    await this.database.query(`INSERT INTO main_material_import_batches(id,mode,file_name,file_hash,status,validation_report,normalized_payload,created_by_user_id)
      VALUES($1,'DELTA',$2,$3,'VALIDATED',$4,'[]',$5) ON CONFLICT(id) DO UPDATE SET validation_report=EXCLUDED.validation_report WHERE main_material_import_batches.status='VALIDATED'`, [legacyId, saved.file_name, hash(`direct:${id}`), { blockerCount: 0, directImport: publication }, actor.id]);
    try { await this.repository.publishImportBatch(legacyId, actor.id, saved.preview_hash); }
    catch (error) { throw new ConflictException(error instanceof Error && error.message ? error.message : "发布失败，原主材库保持不变"); }
    return this.view(await this.find(id));
  }
  private async find(id: string): Promise<DirectRow> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new NotFoundException("导入批次不存在");
    const result = await this.database.query<DirectRow>("SELECT * FROM direct_material_imports WHERE id=$1", [id]);
    if (!result.rows[0]) throw new NotFoundException("导入批次不存在"); return result.rows[0];
  }
  private async preview(source: DirectSource, information: DirectMaterialInformation): Promise<StoredPreview> {
    const catalog = await this.repository.getPublishedCatalog();
    const history = await this.database.query<{ material_id: string; category_code: string; brand: string; model: string; item_name: string; spec: string; colors: string[]; data_status: string }>(`SELECT DISTINCT material_id,category_code,brand,model,item_name,spec,colors,data_status FROM main_material_item_versions`);
    const historical = history.rows.map(r => ({ materialId: r.material_id, categoryCode: r.category_code, brand: r.brand, model: r.model, itemName: r.item_name, spec: r.spec, colors: r.colors, status: r.data_status })) as unknown as MainMaterialItem[];
    const hydrated = await this.hydrate(source);
    const configured = catalog ? [] : JSON.parse((await this.baseline()).toString("utf8")).items as MainMaterialItem[];
    const models = new Set(source.sheets.flatMap(sheet => sheet.rows.map(row => row.values.model)));
    const assetHashes: Record<string,string> = {};
    for (const id of new Set(catalog?.items.filter(item => models.has(item.model)).flatMap(item => item.assetIds) ?? [])) {
      const asset = await this.repository.findAsset(id);
      if (!asset) continue;
      for (const path of [resolve(process.cwd(), "assets", asset.storagePath), resolve(process.cwd(), "apps/api/assets", asset.storagePath)]) {
        try { assetHashes[id] = hash(await readFile(path)); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
    const plan = makeDirectPlan(hydrated, information, catalog, historical, { configuredNames: directNameOptions(configured), assetHashes });
    // Data URLs are computed for each response; the plan hash binds the bytes, not host paths.
    for (const row of plan.rows) for (const image of row.images) image.url = "";
    return { baseCatalogId: catalog?.id ?? null, baseVersion: catalog?.versionNumber ?? 0, currentCount: catalog?.items.length ?? 0, plan };
  }
  private planHash(source: DirectSource, information: DirectMaterialInformation, preview: StoredPreview) { return hash(JSON.stringify(canonical({ source, information, preview }))); }
  private async baseline(): Promise<Buffer> {
    for (const path of [resolve(process.cwd(), "assets/main-materials/v1/catalog.json"), resolve(process.cwd(), "apps/api/assets/main-materials/v1/catalog.json")]) {
      try { return await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    throw new NotFoundException("既有分类品名配置不可读取");
  }
  private async hydrate(source: DirectSource): Promise<DirectSource> {
    const output = structuredClone(source);
    for (const sheet of output.sheets) for (const row of sheet.rows) for (const image of row.images) {
      const data = await this.archived(imagePath(image.visibleHash),image.visibleHash);
      if (hash(data) !== image.visibleHash) throw new ConflictException("图片校验失败，请重新上传");
      image.visible = data.toString("base64");
    }
    return output;
  }
  private async archive(path: string, payload: Buffer) {
    await this.database.query("INSERT INTO direct_material_import_blobs(content_hash,payload) VALUES($1,$2) ON CONFLICT(content_hash) DO NOTHING",[hash(payload),payload]);
    await storeFile(path,payload);
  }
  private async archived(path: string, expectedHash: string): Promise<Buffer> {
    try{return await readFile(path);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    const saved=await this.database.query<{payload:Buffer}>("SELECT payload FROM direct_material_import_blobs WHERE content_hash=$1",[expectedHash]);
    if(!saved.rows[0]||hash(saved.rows[0].payload)!==expectedHash)throw new ConflictException("归档文件缺失或内容校验失败");
    await mkdir(directStorageRoot(),{recursive:true,mode:0o750});await storeFile(path,saved.rows[0].payload);return saved.rows[0].payload;
  }
  private async published(row: DirectRow): Promise<DirectMaterialBatchView["published"]> {
    const result = await this.database.query<{ id: string; version_number: number; reason: string; item_count: string }>(`SELECT v.id,v.version_number,b.validation_report->'directImport'->>'reason' AS reason,
      (SELECT count(*) FROM main_material_item_versions WHERE catalog_version_id=v.id) AS item_count
      FROM main_material_import_batches b JOIN main_material_catalog_versions v ON v.id=b.published_version_id WHERE b.id=$1 AND b.status='PUBLISHED'`, [row.id]);
    const value = result.rows[0]; return value ? { id: value.id, versionNumber: value.version_number, itemCount: Number(value.item_count), reason: value.reason } : null;
  }
  private async view(saved: DirectRow): Promise<DirectMaterialBatchView> {
    const source = await this.hydrate(saved.source), preview = saved.preview, plan = structuredClone(preview.plan);
    for (const row of plan.rows) for (const image of row.images) {
      const stored = source.sheets.find(s => s.name === plan.selectedSheet)?.rows.find(r => r.row === row.row)?.images.find(i => i.visibleHash === image.visibleHash);
      image.url = stored ? `data:image/png;base64,${stored.visible}` : "";
    }
    const published = await this.published(saved);
    return { id: saved.id, fileName: saved.file_name, fileHash: source.fileHash, parserVersion: source.parserVersion, revision: saved.revision, previewHash: saved.preview_hash,
      baseCatalogId: preview.baseCatalogId, baseVersion: preview.baseVersion, currentCount: preview.currentCount, rows: plan.rows, nameOptions: plan.nameOptions, needsInformation: plan.needsInformation, selectedSheet: plan.selectedSheet, ambiguousPriceLabel: plan.ambiguousPriceLabel,
      sheets: source.sheets.map(s => ({ name: s.name, rowCount: s.rows.length, imageCount: s.rows.reduce((n,r) => n+r.images.length,0), sample: s.rows.slice(0,2).map(r => r.values) })),
      ignoredSheets: source.ignoredSheets, information: saved.information, counts: plan.counts, expectedCount: preview.currentCount + plan.counts.added,
      canPublish: !published && !plan.needsInformation && plan.counts.unresolved === 0 && plan.changes.length > 0, published };
  }
}
async function storeFile(path: string, buffer: Buffer) {
  await storeDirectFile(path,buffer);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("请求正文无效"); return value as Record<string, unknown>;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
}
function validatedInformation(value: unknown): DirectMaterialInformation {
  const input = record(value), allowed = new Set(["sheet", "categoryCode", "unit", "ambiguousPriceMeaning", "rows"]);
  if (Object.keys(input).some(k => !allowed.has(k))) throw new BadRequestException("资料确认含不支持字段");
  for (const k of ["sheet", "categoryCode", "unit", "ambiguousPriceMeaning"]) if (input[k] !== undefined && typeof input[k] !== "string") throw new BadRequestException("资料确认字段无效");
  if (input.ambiguousPriceMeaning !== undefined && !["costPrice", "salePrice"].includes(input.ambiguousPriceMeaning as string)) throw new BadRequestException("请选择价格含义");
  if (input.rows) for (const [key, value] of Object.entries(record(input.rows))) {
    if (!/^\d{1,6}$/.test(key)) throw new BadRequestException("来源行无效");
    const row = record(value);
    if (Object.keys(row).some(k => !["categoryCode", "itemName", "unit", "decision", "values"].includes(k))) throw new BadRequestException("行处理字段无效");
    for (const k of ["categoryCode", "itemName", "unit", "decision"]) if (row[k] !== undefined && typeof row[k] !== "string") throw new BadRequestException("行处理资料无效");
    if (row.decision !== undefined && !["SKIP", "EXCLUDE"].includes(row.decision as string)) throw new BadRequestException("处理决定无效");
    if (row.values && Object.values(record(row.values)).some(v => typeof v !== "string" || v.length > 5000)) throw new BadRequestException("补充业务字段无效");
  }
  return input as DirectMaterialInformation;
}
