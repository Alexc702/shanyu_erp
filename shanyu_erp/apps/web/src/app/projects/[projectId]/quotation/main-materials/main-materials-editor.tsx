"use client";

import type {
  MainMaterialCategoryCode,
  MainMaterialCatalogUpdateCheckView,
  MainMaterialItemView,
  MainMaterialQuotationLine,
  MainMaterialQuotationView,
  PublishedMainMaterialCatalogView,
} from "@shanyu/contracts";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, ImageIcon, Info, Plus, RefreshCw,
  Search, ShoppingBag, Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiUrl } from "@/lib/api-url";
import {
  addMainMaterialLine, checkMainMaterialCatalogUpdate, refreshMainMaterialCatalog,
  removeMainMaterialLine, selectMainMaterial,
} from "@/lib/main-material-client";
import { cn } from "@/lib/utils";

const categoryNames: Readonly<Record<MainMaterialCategoryCode, string>> = {
  BATHROOM: "卫浴", CEILING: "集成吊顶", CUSTOM: "定制类", FLOOR: "木地板",
  GLASS_DOOR: "房门 / 玻璃门", SEAM: "美缝", SHOWER: "淋浴房",
  STONE: "石材 / 岩板", SWITCH: "开关面板", TILE: "瓷砖",
};

const categoryOrder: readonly MainMaterialCategoryCode[] = [
  "TILE", "SEAM", "FLOOR", "GLASS_DOOR", "CEILING",
  "BATHROOM", "SHOWER", "STONE", "SWITCH", "CUSTOM",
];

const candidatePageSize = 12;

export function MainMaterialsEditor({
  canViewCosts,
  catalog,
  initialQuotation,
  projectAddress,
}: {
  readonly canViewCosts: boolean;
  readonly catalog: PublishedMainMaterialCatalogView;
  readonly initialQuotation: MainMaterialQuotationView;
  readonly projectAddress: string;
}) {
  const [quotation, setQuotation] = useState(initialQuotation);
  const [category, setCategory] = useState<MainMaterialCategoryCode>("TILE");
  const [picker, setPicker] = useState<{ line: MainMaterialQuotationLine | null; category: MainMaterialCategoryCode } | null>(null);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [series, setSeries] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<MainMaterialItemView | null>(null);
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("所有修改会立即保存");
  const [updateCheck, setUpdateCheck] = useState<MainMaterialCatalogUpdateCheckView | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const editable = quotation.status === "DRAFT";
  const visibleLines = quotation.lines.filter((line) => line.categoryCode === category);
  const missing = quotation.lines.filter((line) => line.origin === "AUTO_TILE" && !line.item);
  const compatibleCandidates = useMemo(() => catalog.items.filter((item) => {
    if (item.status !== "ACTIVE" || item.categoryCode !== picker?.category) return false;
    return picker?.line?.origin !== "AUTO_TILE" || normalizeSpec(item.spec) === normalizeSpec(picker.line.demandSpec);
  }), [catalog.items, picker]);
  const brands = useMemo(() => sortedUnique(compatibleCandidates.map((item) => item.brand)), [compatibleCandidates]);
  const seriesOptions = useMemo(() => sortedUnique(compatibleCandidates
    .filter((item) => !brand || item.brand === brand)
    .map((item) => item.series)), [brand, compatibleCandidates]);
  const candidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return compatibleCandidates.filter((item) => {
      if (brand && item.brand !== brand) return false;
      if (series && item.series !== series) return false;
      return !normalizedQuery || [item.brand, item.series, item.model, item.itemName, item.spec]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [brand, compatibleCandidates, query, series]);
  const candidatePageCount = Math.max(1, Math.ceil(candidates.length / candidatePageSize));
  const visibleCandidates = candidates.slice(
    (candidatePage - 1) * candidatePageSize,
    candidatePage * candidatePageSize,
  );

  function openPicker(line: MainMaterialQuotationLine | null, targetCategory: MainMaterialCategoryCode) {
    setPicker({ line, category: targetCategory });
    const current = line?.item
      ? catalog.items.find((item) => item.materialId === line.item?.materialId) ?? null
      : null;
    setSelectedItem(current);
    setColor(line?.selectedColor ?? "");
    setQuantity(line?.quantity ?? "1");
    setQuery("");
    setBrand("");
    setSeries("");
    setCandidatePage(1);
    setError(null);
  }

  async function checkCatalogUpdate() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const result = await checkMainMaterialCatalogUpdate(quotation.projectId);
      setUpdateCheck(result);
      setUpdateDialogOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "检查主材库更新失败");
    } finally {
      setWorking(false);
    }
  }

  async function adoptCatalogUpdate() {
    if (!updateCheck?.updateAvailable || working) return;
    setWorking(true);
    setError(null);
    try {
      const saved = await refreshMainMaterialCatalog(quotation.projectId, quotation.revision);
      setQuotation(saved);
      setUpdateDialogOpen(false);
      setMessage(`已更新至主材库 V${saved.catalogVersion.versionNumber} · 修订 ${saved.revision}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新主材库版本失败");
    } finally {
      setWorking(false);
    }
  }

  async function saveSelection() {
    if (!picker || !selectedItem || working) return;
    setWorking(true);
    setError(null);
    try {
      const saved = picker.line
        ? await selectMainMaterial(quotation.projectId, picker.line.id, {
            color: color || null,
            expectedRevision: quotation.revision,
            itemVersionId: selectedItem.id,
            ...(picker.line.origin === "MANUAL" ? { quantity } : {}),
          })
        : await addMainMaterialLine(quotation.projectId, {
            categoryCode: picker.category as Exclude<MainMaterialCategoryCode, "TILE">,
            color: color || null,
            expectedRevision: quotation.revision,
            itemVersionId: selectedItem.id,
            quantity,
          });
      setQuotation(saved);
      setPicker(null);
      setMessage(`已保存 · 修订 ${saved.revision}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setWorking(false);
    }
  }

  async function removeLine(line: MainMaterialQuotationLine) {
    if (working || line.origin !== "MANUAL") return;
    setWorking(true);
    setError(null);
    try {
      const saved = await removeMainMaterialLine(
        quotation.projectId, line.id, quotation.revision,
      );
      setQuotation(saved);
      setMessage(`已删除 · 修订 ${saved.revision}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除失败");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="workflow-page max-w-[1600px]">
      <header className="workflow-header gap-4">
        <div className="grid gap-1">
          <Link className="type-action flex w-fit items-center gap-1 text-muted-foreground hover:text-primary" href={`/projects/${quotation.projectId}/quotation`}>
            <ArrowLeft className="size-3.5" />返回半包报价
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="type-page-title">主材选型</h1>
            <Badge variant={editable ? "warning" : "success"}>{editable ? "草稿" : "已锁定"}</Badge>
          </div>
          <p className="type-body m-0 text-muted-foreground">{projectAddress} · 主材库 V{quotation.catalogVersion.versionNumber}</p>
        </div>
        <div className="workflow-actions">
          {editable ? <Button disabled={working} onClick={checkCatalogUpdate} variant="outline"><RefreshCw />检查主材库更新</Button> : null}
          {canViewCosts ? (
            <Button asChild variant="outline"><Link href={`/projects/${quotation.projectId}/quotation/main-materials/cost`}>查看成本分析</Link></Button>
          ) : null}
          <Button asChild variant="outline"><Link href={`/projects/${quotation.projectId}/quotation/main-materials/preview`}>报价预览</Link></Button>
          {editable ? <Button asChild><Link href={`/projects/${quotation.projectId}/quotation/submit`}>统一确认<ChevronRight /></Link></Button> : null}
        </div>
      </header>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-primary-soft px-4 py-3 text-primary">
        <span className="type-table-body flex items-center gap-2"><Info className="size-4" />瓷砖需求来自半包有效工程项，报价数量按基础数量 × 1.15 自动计算。</span>
        <span className="type-support shrink-0">{message}</span>
      </div>
      {error ? <p className="type-body m-0 rounded-md bg-destructive-soft px-3 py-2 text-destructive" role="alert">{error}</p> : null}

      <div className="grid gap-3 xl:grid-cols-[210px_minmax(0,1fr)_270px]">
        <Card className="h-fit border-border py-0 shadow-none">
          <CardContent className="grid gap-1 p-2">
            <h2 className="type-section-title px-2 py-2">主材分类</h2>
            {categoryOrder.map((code) => {
              const count = quotation.lines.filter((line) => line.categoryCode === code).length;
              return (
                <button className={cn("flex min-h-10 items-center justify-between rounded-md px-3 text-left text-sm", category === code ? "bg-primary text-primary-foreground" : "hover:bg-muted")} key={code} onClick={() => setCategory(code)} type="button">
                  <span>{categoryNames[code]}</span><span className="text-xs opacity-75">{count}</span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-border py-0 shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div><h2 className="type-section-title">{categoryNames[category]}</h2><p className="type-support m-0 text-muted-foreground">{category === "TILE" ? "逐条完成半包关联需求" : "按项目需要添加，数量需大于 0"}</p></div>
            {editable && category !== "TILE" ? <Button onClick={() => openPicker(null, category)} size="sm"><Plus />添加主材</Button> : null}
          </div>
          {visibleLines.length ? (
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader><TableRow className="bg-muted"><TableHead>空间 / 来源</TableHead><TableHead>规格</TableHead><TableHead>基础数量</TableHead><TableHead>损耗</TableHead><TableHead>报价数量</TableHead><TableHead>品牌 / 型号</TableHead><TableHead>金额</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
                <TableBody>{visibleLines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell><strong className="block">{line.scopeName}</strong><span className="type-support text-muted-foreground">{line.demandName}</span></TableCell>
                    <TableCell>{line.demandSpec || line.item?.spec || "—"}</TableCell>
                    <TableCell>{line.baseQuantity ? number(line.baseQuantity) : "—"}</TableCell>
                    <TableCell>{line.origin === "AUTO_TILE" ? `${Number(line.lossRate) * 100}%` : "—"}</TableCell>
                    <TableCell className="font-semibold">{number(line.quantity)}</TableCell>
                    <TableCell>{line.item ? <><strong className="block">{line.item.brand || "—"}</strong><span className="type-support text-muted-foreground">{line.item.model || line.item.itemName}{line.selectedColor ? ` · ${line.selectedColor}` : ""}</span></> : <Badge variant="warning">待选择</Badge>}</TableCell>
                    <TableCell className="font-semibold">{line.amount ? money(line.amount) : "—"}</TableCell>
                    <TableCell><div className="flex gap-1"><Button disabled={!editable || working} onClick={() => openPicker(line, category)} size="sm" variant="outline">{line.item ? "更换" : "选择型号"}</Button>{line.origin === "MANUAL" && editable ? <Button aria-label="删除主材行" disabled={working} onClick={() => removeLine(line)} size="icon" variant="ghost"><Trash2 /></Button> : null}</div></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          ) : <div className="grid min-h-56 place-items-center p-6 text-center text-muted-foreground"><div><ShoppingBag className="mx-auto mb-2 size-7" /><p className="type-body m-0">当前分类尚未添加主材</p></div></div>}
        </Card>

        <div className="grid h-fit gap-3">
          <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-3 p-4"><h2 className="type-section-title">主材报价</h2><Summary label="主材直接费" value={quotation.summary.directCost} /><Summary label="服务费（10%）" value={quotation.summary.managementFee} /><div className="border-t border-border pt-3"><Summary emphasis label="主材合计" value={quotation.summary.total} /></div></CardContent></Card>
          <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-2 p-4"><h2 className="type-section-title">完成情况</h2><div className="flex items-center justify-between"><span className="type-table-body">瓷砖需求</span><strong>{quotation.lines.filter((line) => line.origin === "AUTO_TILE" && line.item).length}/{quotation.lines.filter((line) => line.origin === "AUTO_TILE").length}</strong></div>{missing.length ? <p className="type-support m-0 rounded-md bg-warning-soft px-3 py-2 text-warning">还有 {missing.length} 条瓷砖需求未选择型号。</p> : <p className="type-support m-0 flex items-center gap-1 rounded-md bg-success-soft px-3 py-2 text-success"><Check className="size-4" />瓷砖需求已完成</p>}</CardContent></Card>
        </div>
      </div>

      <Dialog onOpenChange={(open) => !open && !working && setPicker(null)} open={Boolean(picker)}>
        <DialogContent className="h-[90vh] w-[calc(100%-2rem)] max-w-[1180px] grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4"><DialogTitle>{picker?.line ? "选择主材型号" : `添加${picker ? categoryNames[picker.category] : "主材"}`}</DialogTitle><DialogDescription>仅显示当前已发布版本中可用且规格匹配的商品。</DialogDescription></DialogHeader>
          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-h-0 overflow-y-auto border-r border-border p-4">
              <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
                <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" onChange={(event) => { setQuery(event.target.value); setCandidatePage(1); }} placeholder="搜索品牌、系列或型号" value={query} /></div>
                <select aria-label="筛选品牌" className="h-9 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => { setBrand(event.target.value); setSeries(""); setCandidatePage(1); }} value={brand}><option value="">全部品牌</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                <select aria-label="筛选系列" className="h-9 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => { setSeries(event.target.value); setCandidatePage(1); }} value={series}><option value="">全部系列</option>{seriesOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select>
              </div>
              <div className="mb-3 flex items-center justify-between gap-2"><span className="type-support text-muted-foreground">共 {candidates.length} 个匹配型号</span>{query || brand || series ? <Button onClick={() => { setQuery(""); setBrand(""); setSeries(""); setCandidatePage(1); }} size="sm" variant="ghost">清除筛选</Button> : null}</div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visibleCandidates.map((item) => <ItemCard active={selectedItem?.id === item.id} canViewCosts={canViewCosts} item={item} key={item.id} onSelect={() => { setSelectedItem(item); setColor(""); }} />)}</div>
              {!candidates.length ? <div className="grid justify-items-center gap-3 py-12 text-center text-muted-foreground"><p className="type-body m-0">没有符合当前规格或筛选条件的可选商品</p><Button onClick={() => { setQuery(""); setBrand(""); setSeries(""); setCandidatePage(1); }} size="sm" variant="outline">清除筛选</Button></div> : null}
              {candidatePageCount > 1 ? <div className="mt-4 flex items-center justify-center gap-2"><Button aria-label="上一页" disabled={candidatePage === 1} onClick={() => setCandidatePage((page) => Math.max(1, page - 1))} size="icon" variant="outline"><ChevronLeft /></Button><span className="type-support">第 {candidatePage} / {candidatePageCount} 页</span><Button aria-label="下一页" disabled={candidatePage === candidatePageCount} onClick={() => setCandidatePage((page) => Math.min(candidatePageCount, page + 1))} size="icon" variant="outline"><ChevronRight /></Button></div> : null}
            </div>
            <div className="min-h-0 overflow-y-auto p-5">{selectedItem ? <ItemDetail canViewCosts={canViewCosts} item={selectedItem} color={color} key={selectedItem.id} quantity={quantity} setColor={setColor} setQuantity={setQuantity} showQuantity={!picker?.line || picker.line.origin === "MANUAL"} /> : <div className="grid h-full min-h-64 place-items-center text-center text-muted-foreground"><div><ImageIcon className="mx-auto mb-2 size-8" /><p className="type-body m-0">选择左侧商品查看图片与详情</p></div></div>}</div>
          </div>
          {error ? <p className="type-support m-0 bg-destructive-soft px-5 py-2 text-destructive" role="alert">{error}</p> : null}
          <DialogFooter className="border-t border-border px-5 py-4"><Button disabled={working} onClick={() => setPicker(null)} variant="outline">取消</Button><Button disabled={!selectedItem || working || Boolean(selectedItem?.colors.length && !color) || Boolean((!picker?.line || picker.line.origin === "MANUAL") && Number(quantity) <= 0)} onClick={saveSelection}>{working ? "正在保存…" : "确认选择"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !working && setUpdateDialogOpen(open)} open={updateDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-[760px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>检查主材库更新</DialogTitle>
            <DialogDescription>{updateCheck ? `项目当前绑定 V${updateCheck.currentVersionNumber}，主材库当前发布 V${updateCheck.latestVersionNumber}。` : "正在读取主材库版本…"}</DialogDescription>
          </DialogHeader>
          {updateCheck?.updateAvailable ? <div className="grid gap-3">
            <p className="type-support m-0 rounded-md bg-warning-soft px-3 py-2 text-warning">更新只影响当前草稿。停用、待补或规格不兼容的已选商品会清空，并需要重新选择。</p>
            {updateCheck.differences.length ? updateCheck.differences.map((difference) => <div className="rounded-lg border border-border p-3" key={difference.lineId}><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="type-table-body">{difference.demandName}</strong><span className="ml-2 type-support text-muted-foreground">{difference.materialId}</span></div><Badge variant={difference.status === "UNAVAILABLE" ? "warning" : "secondary"}>{difference.status === "UNAVAILABLE" ? "需重新选择" : "字段有变化"}</Badge></div>{difference.reason ? <p className="type-support mb-0 mt-2 text-warning">{difference.reason}</p> : <div className="mt-3 grid gap-2">{difference.fields.map((field) => <div className="grid grid-cols-[100px_1fr_20px_1fr] items-center gap-2 text-sm" key={field.field}><span className="text-muted-foreground">{field.label}</span><span className="truncate rounded bg-muted px-2 py-1">{field.before}</span><ChevronRight className="size-4 text-muted-foreground" /><span className="truncate rounded bg-primary-soft px-2 py-1 text-primary">{field.after}</span></div>)}</div>}</div>) : <p className="type-body m-0 rounded-md bg-muted px-3 py-3">已选商品字段没有变化，仍需确认后才会切换草稿绑定版本。</p>}
          </div> : updateCheck ? <p className="type-body m-0 rounded-md bg-success-soft px-3 py-3 text-success">当前草稿已绑定最新主材库版本，无需更新。</p> : null}
          <DialogFooter><Button disabled={working} onClick={() => setUpdateDialogOpen(false)} variant="outline">关闭</Button>{updateCheck?.updateAvailable ? <Button disabled={working} onClick={adoptCatalogUpdate}><RefreshCw />{working ? "正在更新…" : `更新到 V${updateCheck.latestVersionNumber}`}</Button> : null}</DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ItemCard({ active, canViewCosts, item, onSelect }: { readonly active: boolean; readonly canViewCosts: boolean; readonly item: MainMaterialItemView; readonly onSelect: () => void }) {
  const image = item.assets[0];
  return <button className={cn("overflow-hidden rounded-lg border bg-background text-left transition", active ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50")} onClick={onSelect} type="button"><div className="relative aspect-[4/3] bg-muted">{image ? <Image alt={`${item.brand} ${item.model}`} className="object-cover" fill sizes="240px" src={`${apiUrl}${image.path}`} unoptimized /> : <div className="grid h-full place-items-center text-muted-foreground"><ImageIcon /></div>}</div><div className="grid gap-1 p-3"><strong className="truncate text-sm">{item.brand || item.itemName}</strong><span className="truncate text-xs text-muted-foreground">{item.model || item.itemName}</span><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{item.spec || "—"}</span><strong className="text-sm text-primary">{item.salePrice ? `${money(item.salePrice)}/${item.unit}` : "待补"}</strong></div>{canViewCosts && item.costPrice ? <span className="text-xs text-muted-foreground">成本 {money(item.costPrice)}/{item.unit}</span> : null}</div></button>;
}

function ItemDetail({ canViewCosts, item, color, quantity, setColor, setQuantity, showQuantity }: { readonly canViewCosts: boolean; readonly item: MainMaterialItemView; readonly color: string; readonly quantity: string; readonly setColor: (value: string) => void; readonly setQuantity: (value: string) => void; readonly showQuantity: boolean }) {
  const [selectedAssetId, setSelectedAssetId] = useState(item.assets[0]?.id ?? "");
  const image = item.assets.find((asset) => asset.id === selectedAssetId) ?? item.assets[0];
  return <div className="grid gap-4"><div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">{image ? <Image alt={`${item.brand} ${item.model}`} className="object-contain" fill sizes="380px" src={`${apiUrl}${image.path}`} unoptimized /> : <div className="grid h-full place-items-center text-muted-foreground"><ImageIcon /></div>}</div>{item.assets.length > 1 ? <div className="flex gap-2 overflow-x-auto">{item.assets.slice(0, 6).map((asset) => <button aria-label="查看商品附图" className={cn("relative size-16 shrink-0 overflow-hidden rounded border", image?.id === asset.id ? "border-primary ring-2 ring-primary/20" : "border-border")} key={asset.id} onClick={() => setSelectedAssetId(asset.id)} type="button"><Image alt="商品附图" className="object-cover" fill sizes="64px" src={`${apiUrl}${asset.path}`} unoptimized /></button>)}</div> : null}<div><h3 className="type-entity">{item.brand || item.itemName}</h3><p className="type-body m-0 text-muted-foreground">{item.series} {item.model}</p></div><div className="grid grid-cols-2 gap-2 text-sm"><Detail label="品名" value={item.itemName} /><Detail label="规格" value={item.spec} /><Detail label="单位" value={item.unit} /><Detail label="销售价" value={item.salePrice ? money(item.salePrice) : "待补"} />{canViewCosts && item.costPrice ? <Detail label="成本价" value={money(item.costPrice)} /> : null}{Object.entries(item.attributes).filter(([key, value]) => key !== "imageReference" && value).slice(0, 6).map(([key, value]) => <Detail key={key} label={attributeLabel(key)} value={value} />)}</div>{item.colors.length ? <label className="grid gap-1.5 text-sm font-medium">颜色<select className="h-10 rounded-md border border-input bg-background px-3 font-normal" onChange={(event) => setColor(event.target.value)} value={color}><option value="">请选择颜色</option>{item.colors.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label> : null}{showQuantity ? <label className="grid gap-1.5 text-sm font-medium">数量<Input inputMode="decimal" min="0" onChange={(event) => setQuantity(event.target.value)} value={quantity} /></label> : null}</div>;
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) { return <div className="rounded-md bg-muted px-3 py-2"><span className="block text-xs text-muted-foreground">{label}</span><strong className="mt-0.5 block font-medium">{value || "—"}</strong></div>; }
function Summary({ emphasis = false, label, value }: { readonly emphasis?: boolean; readonly label: string; readonly value: string }) { return <div className="flex items-center justify-between gap-2"><span className="type-table-body text-muted-foreground">{label}</span><strong className={emphasis ? "text-xl text-primary" : "text-base"}>{money(value)}</strong></div>; }
function money(value: string) { return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function number(value: string) { return Number(value).toFixed(2); }
function normalizeSpec(value: string) { return value.toLowerCase().replaceAll("×", "*").replaceAll("x", "*").replaceAll("mm", "").replaceAll(" ", ""); }
function sortedUnique(values: readonly string[]) { return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN")); }
function attributeLabel(value: string) { return ({ type: "类型", woodSpecies: "木种", substrate: "基材", thickness: "厚度", grade: "等级", lockType: "锁扣", packaging: "包装", panelSize: "面板尺寸", lightingPower: "照明功率" } as Record<string, string>)[value] ?? value; }
