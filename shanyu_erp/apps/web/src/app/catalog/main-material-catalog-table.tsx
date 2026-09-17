"use client";

import type { MainMaterialCategoryCode, MainMaterialImportBatchView, MainMaterialItemView } from "@shanyu/contracts";
import { ChevronLeft, ChevronRight, Eye, FileCheck2, ImageIcon, Pencil, Plus, RotateCcw, Search, StopCircle } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl } from "@/lib/api-url";
import {
  publishMainMaterialWorkbook,
  validateMainMaterialOnlineEdit,
} from "@/lib/main-material-client";
import {
  formatMainMaterialUnit,
  visibleMainMaterialAttributes,
} from "@/lib/main-material-view-model";

const categories: readonly { readonly code: MainMaterialCategoryCode; readonly name: string }[] = [
  { code: "TILE", name: "瓷砖" },
  { code: "SEAM", name: "美缝" },
  { code: "FLOOR", name: "木地板" },
  { code: "GLASS_DOOR", name: "房门｜门套 - 玻璃门" },
  { code: "CEILING", name: "集成吊顶" },
  { code: "BATHROOM", name: "卫浴" },
  { code: "SHOWER", name: "淋浴房" },
  { code: "STONE", name: "石材｜岩板" },
  { code: "SWITCH", name: "开关面板" },
  { code: "CUSTOM", name: "定制类" },
];

type Operation = "UPSERT" | "DEACTIVATE" | "REACTIVATE";
const pageSize = 25;

interface EditDraft {
  brand: string;
  categoryCode: MainMaterialCategoryCode;
  categoryName: string;
  colors: string;
  costPrice: string;
  grade: string;
  itemName: string;
  lightingPower: string;
  lockType: string;
  materialId: string;
  model: string;
  packaging: string;
  panelSize: string;
  remarks: string;
  salePrice: string;
  series: string;
  spec: string;
  status: MainMaterialItemView["status"];
  substrate: string;
  thickness: string;
  type: string;
  unit: string;
  woodSpecies: string;
}

export function MainMaterialCatalogTable({
  canManage,
  items,
}: {
  readonly canManage: boolean;
  readonly items: readonly MainMaterialItemView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<MainMaterialItemView | null>(null);
  const [operation, setOperation] = useState<Operation>("UPSERT");
  const [draft, setDraft] = useState<EditDraft>(() => emptyDraft());
  const [reason, setReason] = useState("");
  const [batch, setBatch] = useState<MainMaterialImportBatchView | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<MainMaterialItemView | null>(null);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState<"ALL" | MainMaterialItemView["status"]>("ALL");
  const [dataIssue, setDataIssue] = useState<"ALL" | "MISSING" | "NO_IMAGE">("ALL");
  const [sourceFile, setSourceFile] = useState("");
  const [page, setPage] = useState(1);
  const brands = useMemo(() => [...new Set(items.map((item) => item.brand).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN")), [items]);
  const sourceFiles = useMemo(() => [...new Set(items.map((item) => item.sourceFile).filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right, "zh-CN")), [items]);
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (brand && item.brand !== brand) return false;
      if (status !== "ALL" && item.status !== status) return false;
      if (dataIssue === "MISSING" && !item.missingFields) return false;
      if (dataIssue === "NO_IMAGE" && item.assets.length) return false;
      if (sourceFile && item.sourceFile !== sourceFile) return false;
      return !normalizedQuery || [item.materialId, item.itemName, item.brand, item.series, item.model, item.spec]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    }).sort((left, right) => {
      const rank = { ACTIVE: 0, PENDING_DATA: 1, INACTIVE: 2 } as const;
      return rank[left.status] - rank[right.status] ||
        left.brand.localeCompare(right.brand, "zh-CN") ||
        left.model.localeCompare(right.model, "zh-CN");
    });
  }, [brand, dataIssue, items, query, sourceFile, status]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const visibleItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

  function resetFilters() {
    setQuery("");
    setBrand("");
    setStatus("ALL");
    setDataIssue("ALL");
    setSourceFile("");
    setPage(1);
  }

  function begin(item: MainMaterialItemView | null, nextOperation: Operation) {
    setSource(item);
    setOperation(nextOperation);
    setDraft(item ? itemDraft(item) : emptyDraft());
    setReason("");
    setBatch(null);
    setConfirmed(false);
    setMessage(null);
    setOpen(true);
  }

  async function validateChange() {
    setWorking(true);
    setMessage(null);
    try {
      const result = await validateMainMaterialOnlineEdit({
        changeReason: reason,
        expectedRecordVersion: source?.recordVersion ?? 0,
        materialId: draft.materialId.trim(),
        operation,
        values: operation === "UPSERT" ? draftValues(draft) : {},
      });
      setBatch(result);
      setMessage("变更校验通过。请复核后发布新版本。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "变更校验失败");
    } finally {
      setWorking(false);
    }
  }

  async function publish() {
    if (!batch || !confirmed) return;
    setWorking(true);
    setMessage(null);
    try {
      await publishMainMaterialWorkbook(batch.id);
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "发布失败");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="grid gap-3 px-4 pb-4">
      <div className="grid gap-2 lg:grid-cols-[minmax(250px,1fr)_150px_140px_160px_150px_auto]">
        <div className="relative"><Search className="absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 material_id、品名或型号" value={query} /></div>
        <NativeSelect aria-label="筛选品牌" onChange={(event) => { setBrand(event.target.value); setPage(1); }} value={brand}><option value="">品牌：全部</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</NativeSelect>
        <NativeSelect aria-label="筛选状态" onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }} value={status}><option value="ALL">状态：全部</option><option value="ACTIVE">可用</option><option value="PENDING_DATA">待补资料</option><option value="INACTIVE">停用</option></NativeSelect>
        <NativeSelect aria-label="筛选资料完整性" onChange={(event) => { setDataIssue(event.target.value as typeof dataIssue); setPage(1); }} value={dataIssue}><option value="ALL">缺失字段：全部</option><option value="MISSING">仅缺失字段</option><option value="NO_IMAGE">仅无产品图</option></NativeSelect>
        <NativeSelect aria-label="筛选数据来源" onChange={(event) => { setSourceFile(event.target.value); setPage(1); }} value={sourceFile}><option value="">来源：全部</option>{sourceFiles.map((value) => <option key={value} value={value}>{value}</option>)}</NativeSelect>
        <Button onClick={resetFilters} size="sm" type="button" variant="ghost">重置</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="type-support text-muted-foreground">显示 {visibleItems.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredItems.length)} / {filteredItems.length} 条记录</span>
        {canManage ? (
          <Button onClick={() => begin(null, "UPSERT")} size="sm" type="button">
            <Plus />新建主材记录
          </Button>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table className={canManage ? "min-w-[1040px]" : "min-w-[900px]"}>
          <TableHeader><TableRow className="bg-muted hover:bg-muted"><TableHead className="w-[66px]">图片</TableHead><TableHead className="w-[160px]">材料 ID</TableHead><TableHead className="w-[92px]">分类</TableHead><TableHead className="w-[190px]">品牌 / 名称</TableHead><TableHead className="w-[170px]">型号 / 规格</TableHead><TableHead className="w-[62px]">单位</TableHead><TableHead className="w-[82px]">销售价</TableHead>{canManage ? <TableHead className="w-[82px]">成本价</TableHead> : null}<TableHead className="w-[92px]">状态</TableHead><TableHead className="w-[156px]">操作</TableHead></TableRow></TableHeader>
          <TableBody>{visibleItems.map((item, index) => (
            <TableRow key={item.id}>
              <TableCell>{item.assets[0] ? <button aria-label={`查看 ${item.brand} ${item.model} 详情`} className="relative block size-10 overflow-hidden rounded-md border border-border bg-muted" onClick={() => setDetail(item)} type="button"><Image alt={`${item.brand} ${item.model}`} className="object-cover" fill loading={index === 0 ? "eager" : "lazy"} sizes="40px" src={`${apiUrl}${item.assets[0].path}`} unoptimized /></button> : <span className="inline-flex size-10 items-center justify-center rounded-md border border-dashed text-muted-foreground" title="暂无图片"><ImageIcon className="size-4" /></span>}</TableCell>
              <TableCell><span className="block max-w-[150px] truncate font-mono text-xs" title={item.materialId}>{item.materialId}</span></TableCell>
              <TableCell>{item.categoryName}</TableCell>
              <TableCell><strong>{item.brand || item.itemName || "—"}</strong><span className="block max-w-[180px] truncate text-xs text-muted-foreground">{item.itemName || item.series || "—"}</span></TableCell>
              <TableCell><span className="block max-w-[160px] truncate">{item.model || item.series || "—"}</span><span className="block max-w-[160px] truncate text-xs text-muted-foreground">{item.spec || "—"}{item.colors.length ? ` · ${item.colors.join("、")}` : ""}</span></TableCell>
              <TableCell>{formatMainMaterialUnit(item.unit)}</TableCell>
              <TableCell>¥ {formatPrice(item.salePrice)}</TableCell>
              {canManage ? <TableCell>¥ {formatPrice(item.costPrice)}</TableCell> : null}
              <TableCell><Badge variant={item.status === "ACTIVE" ? "success" : item.status === "PENDING_DATA" ? "warning" : "secondary"}>{item.status === "ACTIVE" ? "ACTIVE" : item.status === "PENDING_DATA" ? "待补资料" : "已停用"}</Badge></TableCell>
              <TableCell><div className="flex gap-1"><Button aria-label="查看详情" onClick={() => setDetail(item)} size="icon" type="button" variant="ghost"><Eye /></Button>{canManage ? <><Button aria-label="编辑主材" onClick={() => begin(item, "UPSERT")} size="icon" type="button" variant="ghost"><Pencil /></Button>{item.status === "INACTIVE" ? <Button aria-label="恢复主材" onClick={() => begin(item, "REACTIVATE")} size="icon" type="button" variant="ghost"><RotateCcw /></Button> : <Button aria-label="停用主材" onClick={() => begin(item, "DEACTIVATE")} size="icon" type="button" variant="ghost"><StopCircle /></Button>}</> : null}</div></TableCell>
            </TableRow>
          ))}{!visibleItems.length ? <TableRow><TableCell className="h-32 text-center text-muted-foreground" colSpan={canManage ? 10 : 9}>没有符合当前筛选条件的记录</TableCell></TableRow> : null}</TableBody>
        </Table>
      </div>
      {pageCount > 1 ? <div className="flex items-center justify-end gap-2"><Button aria-label="上一页" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} size="icon" variant="outline"><ChevronLeft /></Button><span className="type-support">第 {page} / {pageCount} 页</span><Button aria-label="下一页" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} size="icon" variant="outline"><ChevronRight /></Button></div> : null}

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-h-[90vh] max-w-[760px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogTitle(source, operation)}</DialogTitle>
            <DialogDescription>校验通过后再发布；发布会生成新的不可变主材库版本。</DialogDescription>
          </DialogHeader>
          {operation === "UPSERT" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field disabled={Boolean(source)} label="material_id" onChange={(value) => updateDraft(setDraft, "materialId", value)} required value={draft.materialId} />
              <label className="grid gap-1.5"><Label>分类 *</Label><NativeSelect onChange={(event) => { const selected = categories.find((item) => item.code === event.target.value); if (selected) setDraft((current) => ({ ...current, categoryCode: selected.code, categoryName: selected.name })); }} value={draft.categoryCode}>{categories.map((category) => <option key={category.code} value={category.code}>{category.name}</option>)}</NativeSelect></label>
              <Field label="品名 / 项目" onChange={(value) => updateDraft(setDraft, "itemName", value)} value={draft.itemName} />
              <Field label="品牌" onChange={(value) => updateDraft(setDraft, "brand", value)} value={draft.brand} />
              <Field label="系列 / 工艺" onChange={(value) => updateDraft(setDraft, "series", value)} value={draft.series} />
              <Field label="型号" onChange={(value) => updateDraft(setDraft, "model", value)} value={draft.model} />
              <Field label="规格" onChange={(value) => updateDraft(setDraft, "spec", value)} value={draft.spec} />
              <Field label="可选颜色（分号分隔）" onChange={(value) => updateDraft(setDraft, "colors", value)} value={draft.colors} />
              <Field label="单位 *" onChange={(value) => updateDraft(setDraft, "unit", value)} required value={draft.unit} />
              <label className="grid gap-1.5"><Label>数据状态 *</Label><NativeSelect onChange={(event) => updateDraft(setDraft, "status", event.target.value as EditDraft["status"])} value={draft.status}><option value="ACTIVE">可用</option><option value="PENDING_DATA">待补资料</option><option value="INACTIVE">停用</option></NativeSelect></label>
              <Field label="销售价" onChange={(value) => updateDraft(setDraft, "salePrice", value)} type="number" value={draft.salePrice} />
              <Field label="成本价" onChange={(value) => updateDraft(setDraft, "costPrice", value)} type="number" value={draft.costPrice} />
              <div className="sm:col-span-2 mt-1 border-t border-border pt-3"><p className="type-support m-0 font-medium text-foreground">类别专用字段</p></div>
              <Field label="类型" onChange={(value) => updateDraft(setDraft, "type", value)} value={draft.type} />
              <Field label="木种" onChange={(value) => updateDraft(setDraft, "woodSpecies", value)} value={draft.woodSpecies} />
              <Field label="基材" onChange={(value) => updateDraft(setDraft, "substrate", value)} value={draft.substrate} />
              <Field label="规格 / 面皮厚度" onChange={(value) => updateDraft(setDraft, "thickness", value)} value={draft.thickness} />
              <Field label="等级" onChange={(value) => updateDraft(setDraft, "grade", value)} value={draft.grade} />
              <Field label="锁扣" onChange={(value) => updateDraft(setDraft, "lockType", value)} value={draft.lockType} />
              <Field label="包装" onChange={(value) => updateDraft(setDraft, "packaging", value)} value={draft.packaging} />
              <Field label="面板尺寸" onChange={(value) => updateDraft(setDraft, "panelSize", value)} value={draft.panelSize} />
              <Field label="照明功率" onChange={(value) => updateDraft(setDraft, "lightingPower", value)} value={draft.lightingPower} />
              <label className="grid gap-1.5 sm:col-span-2"><Label>备注</Label><Textarea onChange={(event) => updateDraft(setDraft, "remarks", event.target.value)} value={draft.remarks} /></label>
            </div>
          ) : (
            <p className="type-body m-0 rounded-md bg-muted px-3 py-3">{draft.materialId} · {draft.brand || draft.itemName || draft.model}</p>
          )}
          <label className="grid gap-1.5"><Label>变更原因 *</Label><Textarea onChange={(event) => { setReason(event.target.value); setBatch(null); setConfirmed(false); }} placeholder="请简要说明本次变更" value={reason} /></label>
          {message ? <p aria-live="polite" className="type-support m-0 rounded-md bg-muted px-3 py-2">{message}</p> : null}
          {batch ? <label className="flex items-start gap-2 rounded-md border border-border p-3"><Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} /><span className="type-support">我已复核本次变更，确认发布为新的主材库版本。</span></label> : null}
          <DialogFooter>
            <Button disabled={working} onClick={() => setOpen(false)} type="button" variant="outline">取消</Button>
            {!batch ? <Button disabled={working || !reason.trim()} onClick={validateChange} type="button">{working ? "正在校验…" : "校验变更"}</Button> : <Button disabled={working || !confirmed} onClick={publish} type="button"><FileCheck2 />{working ? "正在发布…" : "确认发布"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(nextOpen) => !nextOpen && setDetail(null)} open={Boolean(detail)}>
        <DialogContent className="max-h-[90vh] max-w-[860px] overflow-y-auto">
          <DialogHeader><DialogTitle>主材记录详情</DialogTitle><DialogDescription>{detail?.materialId} · 记录版本 {detail?.recordVersion}</DialogDescription></DialogHeader>
          {detail ? <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">{detail.assets.length ? detail.assets.map((asset, index) => <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted" key={asset.id}><Image alt={`${detail.brand} ${detail.model} 产品图 ${index + 1}`} className="object-contain" fill sizes="260px" src={`${apiUrl}${asset.path}`} unoptimized /></div>) : <div className="grid aspect-[4/3] place-items-center rounded-lg bg-muted text-muted-foreground"><div className="text-center"><ImageIcon className="mx-auto mb-2" />暂无产品图</div></div>}</div>
            <div className="grid gap-2 sm:grid-cols-3"><CatalogDetail label="品牌" value={detail.brand} /><CatalogDetail label="系列 / 工艺" value={detail.series} /><CatalogDetail label="型号" value={detail.model} /><CatalogDetail label="品名 / 项目" value={detail.itemName} /><CatalogDetail label="规格" value={detail.spec} /><CatalogDetail label="可选颜色" value={detail.colors.join("、")} /><CatalogDetail label="单位" value={formatMainMaterialUnit(detail.unit)} /><CatalogDetail label="销售价" value={detail.salePrice ? `¥ ${formatPrice(detail.salePrice)}` : "—"} />{canManage ? <CatalogDetail label="成本价" value={detail.costPrice ? `¥ ${formatPrice(detail.costPrice)}` : "—"} /> : null}{visibleMainMaterialAttributes(detail.attributes).map(([key, value]) => <CatalogDetail key={key} label={attributeLabel(key)} value={value} />)}</div>
            {detail.missingFields ? <p className="type-support m-0 rounded-md bg-warning-soft px-3 py-2 text-warning">缺失字段：{detail.missingFields}</p> : null}
            {detail.remarks ? <div><Label>备注</Label><p className="type-body mb-0 mt-1 rounded-md bg-muted px-3 py-2">{detail.remarks}</p></div> : null}
          </div> : null}
          <DialogFooter><Button onClick={() => setDetail(null)} variant="outline">关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ disabled = false, label, onChange, required = false, type = "text", value }: { readonly disabled?: boolean; readonly label: string; readonly onChange: (value: string) => void; readonly required?: boolean; readonly type?: string; readonly value: string }) {
  return <label className="grid gap-1.5"><Label>{label}{required ? " *" : ""}</Label><Input disabled={disabled} min={type === "number" ? "0" : undefined} onChange={(event) => onChange(event.target.value)} step={type === "number" ? "0.01" : undefined} type={type} value={value} /></label>;
}

function emptyDraft(): EditDraft {
  return { brand: "", categoryCode: "TILE", categoryName: "瓷砖", colors: "", costPrice: "", grade: "", itemName: "", lightingPower: "", lockType: "", materialId: "", model: "", packaging: "", panelSize: "", remarks: "", salePrice: "", series: "", spec: "", status: "PENDING_DATA", substrate: "", thickness: "", type: "", unit: "", woodSpecies: "" };
}

function itemDraft(item: MainMaterialItemView): EditDraft {
  return { brand: item.brand, categoryCode: item.categoryCode, categoryName: item.categoryName, colors: item.colors.join("；"), costPrice: item.costPrice ?? "", grade: item.attributes.grade ?? "", itemName: item.itemName, lightingPower: item.attributes.lightingPower ?? "", lockType: item.attributes.lockType ?? "", materialId: item.materialId, model: item.model, packaging: item.attributes.packaging ?? "", panelSize: item.attributes.panelSize ?? "", remarks: item.remarks, salePrice: item.salePrice ?? "", series: item.series, spec: item.spec, status: item.status, substrate: item.attributes.substrate ?? "", thickness: item.attributes.thickness ?? "", type: item.attributes.type ?? "", unit: item.unit, woodSpecies: item.attributes.woodSpecies ?? "" };
}

function draftValues(draft: EditDraft): Readonly<Record<string, string | null>> {
  return { brand: draft.brand, category_code: draft.categoryCode, category_name: draft.categoryName, color: draft.colors, cost_price: draft.costPrice || null, data_status: draft.status, grade: draft.grade, item_name: draft.itemName, lighting_power: draft.lightingPower, lock_type: draft.lockType, model: draft.model, packaging: draft.packaging, panel_size: draft.panelSize, remarks: draft.remarks, sale_price: draft.salePrice || null, series: draft.series, spec: draft.spec, substrate: draft.substrate, thickness: draft.thickness, type: draft.type, unit: draft.unit, wood_species: draft.woodSpecies };
}

function updateDraft<Key extends keyof EditDraft>(setter: Dispatch<SetStateAction<EditDraft>>, key: Key, value: EditDraft[Key]) {
  setter((current) => ({ ...current, [key]: value }));
}

function dialogTitle(item: MainMaterialItemView | null, operation: Operation): string {
  if (!item) return "新建主材记录";
  if (operation === "DEACTIVATE") return "停用主材记录";
  if (operation === "REACTIVATE") return "恢复主材记录";
  return "编辑主材记录";
}

function formatPrice(value: string | null | undefined): string {
  return value ? Number(value).toFixed(2) : "—";
}

function CatalogDetail({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="rounded-md bg-muted px-3 py-2"><span className="block text-xs text-muted-foreground">{label}</span><strong className="mt-0.5 block break-words text-sm font-medium">{value || "—"}</strong></div>;
}

function attributeLabel(value: string): string {
  return ({
    grade: "等级", lightingPower: "照明功率", lockType: "锁扣",
    packaging: "包装", panelSize: "面板尺寸", substrate: "基材",
    thickness: "规格 / 面皮厚度", type: "类型", woodSpecies: "木种",
  } as Record<string, string>)[value] ?? value;
}
