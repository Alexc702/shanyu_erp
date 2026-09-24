"use client";
import { useProjectReadonly } from "../../project-access";

import type {
  MainMaterialCategoryCode,
  MainMaterialCatalogUpdateCheckView,
  MainMaterialItemView,
  MainMaterialQuotationLine,
  MainMaterialQuotationView,
  PublishedMainMaterialCatalogView,
} from "@shanyu/contracts";
import {
  ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, ImageIcon, Info, Plus,
  RefreshCw, Search, ShoppingBag, Trash2, ZoomIn,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiUrl } from "@/lib/api-url";
import {
  addMainMaterialLine, checkMainMaterialCatalogUpdate, fetchMainMaterialQuotationCatalog,
  fetchMainMaterialQuotation, refreshMainMaterialCatalog,
  removeMainMaterialLine, selectMainMaterial, updateMainMaterialDemand,
} from "@/lib/main-material-client";
import {
  decodeMainMaterialGlassDoorSelection,
  decodeMainMaterialShowerSelection,
  encodeMainMaterialGlassDoorSelection,
  encodeMainMaterialShowerSelection,
  findMainMaterialVariant,
  formatMainMaterialScopeName,
  formatMainMaterialUnit,
  formatMainMaterialQuantity,
  mainMaterialTileSpecCompatible,
  groupMainMaterialCandidates,
  isLange34A,
  mainMaterialSelectionDescription,
  mainMaterialBaseQuantity,
  mainMaterialCandidateKey,
  mainMaterialColorAsset,
  mainMaterialDefaultQuantity,
  mainMaterialDisplayModel,
  mainMaterialDemandEditing,
  mainMaterialGlassColorAsset,
  mainMaterialGlassColors,
  mainMaterialShowerTypes,
  mainMaterialProductAsset,
  mainMaterialVariantColor,
  visibleMainMaterialAttributes,
} from "@/lib/main-material-view-model";
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
  projectOuterFrameArea,
}: {
  readonly canViewCosts: boolean;
  readonly catalog: PublishedMainMaterialCatalogView;
  readonly initialQuotation: MainMaterialQuotationView;
  readonly projectAddress: string;
  readonly projectOuterFrameArea: string;
}) {
  const router = useRouter();
  const [quotation, setQuotation] = useState(initialQuotation);
  const [selectionCatalog, setSelectionCatalog] = useState(catalog);
  const [category, setCategory] = useState<MainMaterialCategoryCode>("TILE");
  const [picker, setPicker] = useState<{ line: MainMaterialQuotationLine | null; category: MainMaterialCategoryCode } | null>(null);
  const [query, setQuery] = useState("");
  const [itemName, setItemName] = useState("");
  const [brand, setBrand] = useState("");
  const [series, setSeries] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<MainMaterialItemView | null>(null);
  const [color, setColor] = useState("");
  const [frameColor, setFrameColor] = useState("");
  const [glassColor, setGlassColor] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [focusedQuantityId, setFocusedQuantityId] = useState<string | null>(null);
  const [tileQuery, setTileQuery] = useState("");
  const [onlyIncompleteTiles, setOnlyIncompleteTiles] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("所有修改会立即保存");
  const [demandDrafts, setDemandDrafts] = useState<Readonly<Record<string, {
    readonly baseQuantity: string;
    readonly lossPercent: string;
  }>>>({});
  const [updateCheck, setUpdateCheck] = useState<MainMaterialCatalogUpdateCheckView | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const readOnly = useProjectReadonly();
  const editable = quotation.status === "DRAFT" && !readOnly;
  const visibleLines = quotation.lines.filter((line) => line.categoryCode === category);
  const filteredVisibleLines = category === "TILE"
    ? visibleLines.filter((line) => {
        const normalizedQuery = tileQuery.trim().toLowerCase();
        if (onlyIncompleteTiles && line.item) return false;
        return !normalizedQuery || [line.scopeName, line.demandName, line.demandSpec, line.item?.brand, line.item?.model]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : visibleLines;
  const missing = quotation.lines.filter((line) => line.origin === "AUTO_TILE" && !line.item);
  const tileLines = quotation.lines.filter((line) => line.origin === "AUTO_TILE");
  const selectedCategoryCount = categoryOrder.filter((code) => quotation.lines.some((line) => line.categoryCode === code && line.item)).length;
  const compatibleCandidates = useMemo(() => selectionCatalog.items.filter((item) => {
    if (item.status !== "ACTIVE" || item.categoryCode !== picker?.category) return false;
    return picker?.line?.origin !== "AUTO_TILE" || mainMaterialTileSpecCompatible(picker.line.demandName, picker.line.demandSpec, item);
  }), [picker, selectionCatalog.items]);
  const compatibleGroups = useMemo(
    () => [...groupMainMaterialCandidates(compatibleCandidates)].sort((left, right) =>
      picker?.category === "FLOOR"
        ? floorBrandRank(left.primary.brand) - floorBrandRank(right.primary.brand)
        : 0,
    ),
    [compatibleCandidates, picker?.category],
  );
  const itemNames = useMemo(() => sortedUnique(compatibleGroups.map((group) => group.primary.itemName)), [compatibleGroups]);
  const brands = useMemo(() => sortedUnique(compatibleGroups
    .filter((group) => !itemName || group.primary.itemName === itemName)
    .map((group) => group.primary.brand)).sort((left, right) =>
    picker?.category === "FLOOR" ? floorBrandRank(left) - floorBrandRank(right) : 0,
  ), [compatibleGroups, itemName, picker?.category]);
  const seriesOptions = useMemo(() => sortedUnique(compatibleGroups
    .filter((group) => (!itemName || group.primary.itemName === itemName) && (!brand || group.primary.brand === brand))
    .map((group) => group.primary.series)), [brand, compatibleGroups, itemName]);
  const candidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return compatibleGroups.filter((group) => {
      const item = group.primary;
      if (itemName && item.itemName !== itemName) return false;
      if (brand && item.brand !== brand) return false;
      if (series && item.series !== series) return false;
      return !normalizedQuery || group.variants.some((variant) =>
        [variant.brand, variant.series, variant.model, variant.itemName, variant.spec,
          mainMaterialVariantColor(variant)]
          .some((value) => value.toLowerCase().includes(normalizedQuery)),
      );
    });
  }, [brand, compatibleGroups, itemName, query, series]);
  const candidatePageCount = Math.max(1, Math.ceil(candidates.length / candidatePageSize));
  const visibleCandidates = candidates.slice(
    (candidatePage - 1) * candidatePageSize,
    candidatePage * candidatePageSize,
  );

  function openPicker(line: MainMaterialQuotationLine | null, targetCategory: MainMaterialCategoryCode) {
    setPicker({ line, category: targetCategory });
    const current = line?.item
      ? selectionCatalog.items.find((item) => item.materialId === line.item?.materialId) ?? null
      : null;
    setSelectedItem(current);
    const selectedColor = line?.selectedColor ?? "";
    const glassDoorSelection = decodeMainMaterialGlassDoorSelection(selectedColor);
    setColor(targetCategory === "GLASS_DOOR" ? "" : selectedColor);
    setFrameColor(targetCategory === "GLASS_DOOR" ? glassDoorSelection.frameColor : "");
    setGlassColor(targetCategory === "GLASS_DOOR" ? glassDoorSelection.glassColor : "");
    setQuantity(line?.quantity ?? "1");
    setQuery("");
    setItemName("");
    setBrand("");
    setSeries("");
    setCandidatePage(1);
    setError(null);
  }

  function selectCandidate(item: MainMaterialItemView) {
    setSelectedItem(item);
    if (item.categoryCode === "GLASS_DOOR") {
      setColor("");
      setFrameColor("");
      setGlassColor("");
    } else {
      setColor(mainMaterialVariantColor(item));
    }
    if (!picker?.line) {
      setQuantity(mainMaterialDefaultQuantity(item, projectOuterFrameArea));
    }
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
      const refreshedCatalog = await fetchMainMaterialQuotationCatalog(quotation.projectId);
      setQuotation(saved);
      setSelectionCatalog(refreshedCatalog);
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
      const selectedColor = selectedItem.categoryCode === "GLASS_DOOR"
        ? encodeMainMaterialGlassDoorSelection(frameColor, glassColor)
        : color;
      const saved = picker.line
        ? await selectMainMaterial(quotation.projectId, picker.line.id, {
            color: selectedColor || null,
            expectedRevision: quotation.revision,
            itemVersionId: selectedItem.id,
            ...(picker.line.origin === "MANUAL" ? { quantity } : {}),
          })
        : await addMainMaterialLine(quotation.projectId, {
            categoryCode: picker.category as Exclude<MainMaterialCategoryCode, "TILE">,
            color: selectedColor || null,
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

  const selectedGlassColors = selectedItem ? mainMaterialGlassColors(selectedItem) : [];
  const selectedShowerTypes = selectedItem ? mainMaterialShowerTypes(selectedItem) : [];
  const showerSelection = decodeMainMaterialShowerSelection(color);
  const selectionIncomplete = selectedItem?.categoryCode === "GLASS_DOOR"
    ? Boolean(selectedGlassColors.length && !glassColor) ||
      Boolean(selectedItem.colors.length && !frameColor)
    : selectedShowerTypes.length
      ? !selectedShowerTypes.includes(showerSelection.type) || !selectedItem?.colors.includes(showerSelection.color)
      : Boolean(selectedItem?.colors.length && !color);

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

  async function saveDemand(line: MainMaterialQuotationLine) {
    const draft = demandDrafts[line.id] ?? {
      baseQuantity: mainMaterialBaseQuantity(line),
      lossPercent: String(Number(line.lossRate) * 100),
    };
    const baseQuantity = Number(draft.baseQuantity);
    const lossPercent = Number(draft.lossPercent);
    if (!Number.isFinite(baseQuantity) || baseQuantity <= 0 ||
        !Number.isFinite(lossPercent) || lossPercent < 0 || lossPercent > 100) {
      setError("基础数量必须大于 0，损耗必须在 0% 到 100% 之间");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const saved = await updateMainMaterialDemand(quotation.projectId, line.id, {
        baseQuantity: draft.baseQuantity,
        expectedRevision: quotation.revision,
        lossRate: (lossPercent / 100).toFixed(4),
      });
      setQuotation(saved);
      setDemandDrafts((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      setMessage(`已保存需求数量 · 修订 ${saved.revision}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存需求数量失败");
    } finally {
      setWorking(false);
    }
  }

  async function saveDraft(): Promise<boolean> {
    if (working) return false;
    const pending: Array<{
      draft: { readonly baseQuantity: string; readonly lossPercent: string };
      invalid: boolean;
      line: MainMaterialQuotationLine;
    }> = [];
    for (const line of quotation.lines) {
      const draft = demandDrafts[line.id];
      if (!draft) continue;
      const baseQuantity = Number(draft.baseQuantity);
      const lossPercent = Number(draft.lossPercent);
      if (!Number.isFinite(baseQuantity) || baseQuantity <= 0 ||
          !Number.isFinite(lossPercent) || lossPercent < 0 || lossPercent > 100) {
        pending.push({ draft, invalid: true, line });
        continue;
      }
      const changed = Number(draft.baseQuantity) !== Number(mainMaterialBaseQuantity(line)) ||
        lossPercent !== Number(line.lossRate) * 100;
      if (changed) pending.push({ draft, invalid: false, line });
    }
    if (pending.some((change) => change.invalid)) {
      setError("基础数量必须大于 0，损耗必须在 0% 到 100% 之间");
      return false;
    }

    setWorking(true);
    setError(null);
    let saved = quotation;
    try {
      saved = await fetchMainMaterialQuotation(quotation.projectId);
      for (const change of pending) {
        const currentLine = saved.lines.find((line) => line.id === change.line.id);
        if (!currentLine) continue;
        const baseQuantity = change.draft.baseQuantity;
        const lossRate = (Number(change.draft.lossPercent) / 100).toFixed(4);
        if (Number(baseQuantity) === Number(mainMaterialBaseQuantity(currentLine)) &&
            Number(lossRate) === Number(currentLine.lossRate)) continue;
        saved = await updateMainMaterialDemand(saved.projectId, currentLine.id, {
          baseQuantity,
          expectedRevision: saved.revision,
          lossRate,
        });
      }
      setQuotation(saved);
      setDemandDrafts({});
      setMessage(`草稿已保存 · 修订 ${saved.revision}`);
      return true;
    } catch (caught) {
      setQuotation(saved);
      setError(caught instanceof Error ? caught.message : "保存草稿失败");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function returnToHalfPackage() {
    if (await saveDraft()) {
      router.push(`/projects/${quotation.projectId}/quotation`);
    }
  }

  return (
    <main className="workflow-page max-w-[1600px]">
      <header className="workflow-header gap-4">
        <div className="grid gap-1">
          <button className="type-action flex w-fit items-center gap-1 text-muted-foreground hover:text-primary disabled:opacity-50" disabled={working} onClick={returnToHalfPackage} type="button">
            <ArrowLeft className="size-3.5" />返回半包报价
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="type-page-title">主材选型</h1>
            <Badge variant={editable ? "warning" : "success"}>{readOnly ? "只读查看" : editable ? "草稿" : "已锁定"}</Badge>
          </div>
          <p className="type-body m-0 text-muted-foreground">{projectAddress} · 主材库 V{quotation.catalogVersion.versionNumber}</p>
        </div>
        <div className="workflow-actions">
          {editable ? <Button disabled={working} onClick={saveDraft} variant="outline">{working ? "正在保存…" : "保存草稿"}</Button> : null}
          {editable ? <Button disabled={working} onClick={checkCatalogUpdate} variant="outline"><RefreshCw />检查主材库更新</Button> : null}
          {canViewCosts ? (
            <Button asChild variant="outline"><Link href={`/projects/${quotation.projectId}/cost-analysis?quotationId=${encodeURIComponent(quotation.id)}&module=main-material`}>查看主材成本</Link></Button>
          ) : null}
          <Button asChild variant="outline"><Link href={`/projects/${quotation.projectId}/quotation/main-materials/preview`}>报价预览</Link></Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/15 bg-primary-soft px-4 py-3 text-primary">
        <span className="type-table-body flex items-center gap-2"><Info className="size-4 shrink-0" />选型确认后会立即保存；数量修改可点击“保存草稿”统一暂存。瓷砖基础数量来自半包报价，仅损耗可在此调整。</span>
        <span className="type-support shrink-0 rounded-full bg-background/80 px-2.5 py-1">{working ? "正在保存…" : message}</span>
      </div>
      {error ? <p className="type-body m-0 rounded-md bg-destructive-soft px-3 py-2 text-destructive" role="alert">{error}</p> : null}

      <div className="grid gap-3 xl:grid-cols-[168px_minmax(0,1fr)_220px] 2xl:grid-cols-[190px_minmax(0,1fr)_250px]">
        <Card className="h-fit border-border py-0 shadow-none">
          <CardContent className="grid gap-1 p-2">
            <div className="flex items-center justify-between px-2 py-2"><h2 className="type-section-title">主材分类</h2><span className="type-support text-muted-foreground">{selectedCategoryCount} / {categoryOrder.length}</span></div>
            {categoryOrder.map((code) => {
              const categoryLines = quotation.lines.filter((line) => line.categoryCode === code);
              const selectedCount = categoryLines.filter((line) => line.item).length;
              const subtotal = categoryLines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
              return (
                <button className={cn("flex min-h-12 items-center justify-between rounded-md px-3 text-left text-sm transition-colors", category === code ? "bg-primary text-primary-foreground" : "hover:bg-muted")} key={code} onClick={() => { setCategory(code); setTileQuery(""); setOnlyIncompleteTiles(false); }} type="button">
                  <span className="min-w-0"><span className="block truncate font-medium">{categoryNames[code]}</span><span className="block text-[11px] opacity-70">{money(String(subtotal))}</span></span><span className={cn("rounded-full px-2 py-0.5 text-[11px]", category === code ? "bg-white/15" : "bg-muted text-muted-foreground")}>{code === "TILE" ? `${selectedCount}/${categoryLines.length}` : categoryLines.length}</span>
                </button>
              );
            })}
            <div className="mt-1 rounded-md bg-muted px-3 py-2"><span className="type-support block text-muted-foreground">绑定库版本</span><strong className="type-support block mt-0.5">V{quotation.catalogVersion.versionNumber} · {quotation.catalogVersion.name}</strong></div>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-border py-0 shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div><h2 className="type-section-title">{category === "TILE" ? "瓷砖需求" : categoryNames[category]}</h2><p className="type-support m-0 text-muted-foreground">{category === "TILE" ? `按空间与半包来源逐行保留 · ${tileLines.filter((line) => line.item).length} / ${tileLines.length} 已完成` : `按需添加 · 基础数量可编辑 · 共 ${visibleLines.length} 项`}</p></div>
            {category === "TILE" ? <div className="flex flex-wrap items-center gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 w-52 pl-9" onChange={(event) => setTileQuery(event.target.value)} placeholder="搜索空间、工程项或型号" value={tileQuery} /></div><Button aria-pressed={onlyIncompleteTiles} onClick={() => setOnlyIncompleteTiles((current) => !current)} size="sm" variant={onlyIncompleteTiles ? "secondary" : "outline"}>仅看未完成</Button></div> : editable ? <Button onClick={() => openPicker(null, category)} size="sm"><Plus />添加主材</Button> : null}
          </div>
          {filteredVisibleLines.length ? (
            <div className="relative overflow-x-auto">
              <Table className="min-w-[760px] table-fixed">
                <colgroup>
                  <col className="w-[72px]" />
                  <col className="w-[108px]" />
                  <col className="w-[88px]" />
                  {category === "TILE" ? <col className="w-[88px]" /> : null}
                  <col className="w-[68px]" />
                  <col className="w-[40px]" />
                  <col className="w-[100px]" />
                  <col className="w-[72px]" />
                  <col className="w-[72px]" />
                  <col className="w-[112px]" />
                </colgroup>
                <TableHeader><TableRow className="bg-muted hover:bg-muted"><TableHead className="sticky left-0 z-20 border-r border-border bg-muted">{category === "TILE" ? "半包来源" : "空间"}</TableHead><TableHead>主材 / 规格</TableHead><TableHead className="px-1">基础数量</TableHead>{category === "TILE" ? <TableHead className="px-1">损耗</TableHead> : null}<TableHead className="px-1">报价数量</TableHead><TableHead className="px-1">单位</TableHead><TableHead className="whitespace-normal">品牌 / 型号</TableHead><TableHead className="px-2">单价</TableHead><TableHead className="px-2">金额</TableHead><TableHead className="sticky right-0 z-30 w-[112px] border-l border-border bg-muted text-right">操作</TableHead></TableRow></TableHeader>
                <TableBody>{filteredVisibleLines.map((line, index) => {
                  const baseQuantity = mainMaterialBaseQuantity(line);
                  const demandEditing = mainMaterialDemandEditing(line, editable);
                  const draft = demandDrafts[line.id] ?? {
                    baseQuantity,
                    lossPercent: formatPercent(Number(line.lossRate) * 100),
                  };
                  const demandChanged = (
                    Number(draft.baseQuantity) !== Number(baseQuantity) ||
                    Number(draft.lossPercent) !== Number(line.lossRate) * 100
                  );
                  const showScopeHeading = category === "TILE" && filteredVisibleLines[index - 1]?.scopeName !== line.scopeName;
                  const scopeLines = visibleLines.filter((candidate) => candidate.scopeName === line.scopeName);
                  return (
                    <Fragment key={line.id}>
                    {showScopeHeading ? <TableRow className="bg-primary-soft hover:bg-primary-soft"><TableCell className="h-9 py-2 font-semibold text-primary" colSpan={category === "TILE" ? 10 : 9}><div className="flex items-center justify-between"><span>{formatMainMaterialScopeName(line.scopeName)}</span><span className="type-support">{scopeLines.filter((candidate) => candidate.item).length} / {scopeLines.length} 已完成 · 小计 {money(String(scopeLines.reduce((sum, candidate) => sum + Number(candidate.amount ?? 0), 0)))}</span></div></TableCell></TableRow> : null}
                    <TableRow>
                      <TableCell className="sticky left-0 z-10 whitespace-normal break-words border-r border-border bg-background"><strong>{formatMainMaterialScopeName(line.scopeName)}</strong></TableCell>
                      <TableCell className="whitespace-normal break-words"><strong className="block">{line.demandName}</strong><span className="type-support mt-0.5 block whitespace-normal break-words text-muted-foreground">{line.demandSpec || line.item?.spec || "—"}</span></TableCell>
                      <TableCell className="px-1">{demandEditing.baseQuantity ? <Input aria-label={`${formatMainMaterialScopeName(line.scopeName)}${line.demandName}基础数量`} className="w-20" inputMode="decimal" min="0" onChange={(event) => setDemandDrafts((current) => ({ ...current, [line.id]: { ...draft, baseQuantity: event.target.value } }))} onFocus={() => setFocusedQuantityId(line.id)} onBlur={() => setFocusedQuantityId(null)} value={focusedQuantityId === line.id ? draft.baseQuantity : formatMainMaterialQuantity(draft.baseQuantity, line.item?.unit ?? "M²")} /> : <div className="grid gap-0.5"><span>{baseQuantity ? formatMainMaterialQuantity(baseQuantity, line.item?.unit ?? "M²") : "—"}</span>{line.origin === "AUTO_TILE" ? <span className="type-support text-muted-foreground">半包报价同步</span> : null}</div>}</TableCell>
                      {category === "TILE" ? <TableCell className="px-1">{demandEditing.lossRate ? <div className="flex items-center gap-1"><Input aria-label={`${formatMainMaterialScopeName(line.scopeName)}${line.demandName}损耗率`} className="w-16" inputMode="decimal" max="100" min="0" onChange={(event) => setDemandDrafts((current) => ({ ...current, [line.id]: { ...draft, lossPercent: event.target.value } }))} value={draft.lossPercent} /><span>%</span></div> : `${formatPercent(Number(line.lossRate) * 100)}%`}</TableCell> : null}
                      <TableCell className="px-1 font-semibold">{formatMainMaterialQuantity(line.quantity, line.item?.unit ?? "M²")}</TableCell>
                      <TableCell className="whitespace-normal break-words px-1">{formatMainMaterialUnit(line.item?.unit ?? (line.origin === "AUTO_TILE" ? "M²" : "—"))}</TableCell>
                      <TableCell className="whitespace-normal break-words">{line.item ? <><strong className="block whitespace-normal break-words">{line.item.brand || "—"}</strong><span className="type-support block whitespace-normal break-words text-muted-foreground">{mainMaterialSelectionDescription(line.item, line.selectedColor, selectionCatalog.items.find((item) => item.materialId === line.item?.materialId))}</span></> : <Badge variant="warning">待选择</Badge>}</TableCell>
                      <TableCell className="px-2">{line.item ? money(line.item.saleUnitPrice) : "—"}</TableCell>
                      <TableCell className="px-2 font-semibold">{line.amount ? money(line.amount) : "—"}</TableCell>
                      <TableCell className="sticky right-0 z-20 w-[112px] border-l border-border bg-background px-1">{readOnly ? null : <div className="grid justify-items-end gap-1 whitespace-nowrap">{demandChanged ? <Button className="h-8 px-1" disabled={working} onClick={() => saveDemand(line)} size="sm">保存数量</Button> : null}<div className="flex flex-nowrap items-center justify-end gap-1"><Button className="h-8 px-1" disabled={!editable || working} onClick={() => openPicker(line, category)} size="sm" variant="outline">{line.item ? "更换" : "选择型号"}</Button>{line.origin === "MANUAL" && editable ? <Button aria-label="删除主材行" className="size-8" disabled={working} onClick={() => removeLine(line)} size="icon" variant="ghost"><Trash2 /></Button> : null}</div></div>}</TableCell>
                    </TableRow>
                    </Fragment>
                  );
                })}</TableBody>
              </Table>
            </div>
          ) : <div className="grid min-h-56 place-items-center p-6 text-center text-muted-foreground"><div><ShoppingBag className="mx-auto mb-2 size-7" /><p className="type-body m-0">{category === "TILE" && (tileQuery || onlyIncompleteTiles) ? "没有符合当前筛选条件的瓷砖需求" : "当前分类尚未添加主材"}</p></div></div>}
          <div className="flex items-start gap-2 border-t border-border bg-primary-soft/60 px-4 py-3 text-primary"><Info className="mt-0.5 size-4 shrink-0" /><p className="type-support m-0">{category === "TILE" ? "报价数量 = 半包有效数量 ×（1 + 损耗%）。瓷砖基础数量只读，请回半包报价修改；金额按原始精度计价。" : "基础数量可编辑，保存时校验大于 0；数量仅按单位格式显示，金额按原始精度计价。"}</p></div>
        </Card>

        <div className="grid h-fit gap-3">
          <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-3 p-4"><h2 className="type-section-title">主材报价</h2><Summary label="主材直接费" value={quotation.summary.directCost} /><Summary label="服务费（10%）" value={quotation.summary.managementFee} /><div className="border-t border-border pt-3"><Summary emphasis label="主材合计" value={quotation.summary.total} /></div></CardContent></Card>
          <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-2.5 p-4"><h2 className="type-section-title">完成状态</h2><div className="flex items-center justify-between"><span className="type-table-body">已选分类</span><strong>{selectedCategoryCount}/{categoryOrder.length}</strong></div><div className="flex items-center justify-between"><span className="type-table-body">瓷砖选型</span><strong>{tileLines.filter((line) => line.item).length}/{tileLines.length}</strong></div><div className="flex items-center justify-between"><span className="type-table-body">问题</span><strong className={missing.length ? "text-warning" : "text-success"}>{missing.length}</strong></div></CardContent></Card>
          <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-2 p-4"><h2 className="type-section-title">需要处理</h2>{missing.length ? <p className="type-support m-0 flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-warning"><CircleAlert className="mt-0.5 size-4 shrink-0" />{formatMainMaterialScopeName(missing[0]?.scopeName ?? "")} · {missing[0]?.demandName}<br />还有 {missing.length} 条瓷砖需求未完成</p> : <p className="type-support m-0 flex items-center gap-1.5 rounded-md bg-success-soft px-3 py-2 text-success"><Check className="size-4" />当前无阻断项</p>}</CardContent></Card>
          {editable ? missing.length ? <Button disabled>下一步：确认生成报价单<ChevronRight /></Button> : <Button asChild><Link href={`/projects/${quotation.projectId}/quotation/submit`}>下一步：确认生成报价单<ChevronRight /></Link></Button> : null}
        </div>
      </div>

      <Dialog onOpenChange={(open) => !open && !working && setPicker(null)} open={Boolean(picker)}>
        <DialogContent className="h-[calc(100vh-3rem)] max-h-[912px] w-[calc(100%-2rem)] max-w-[1136px] grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 pr-14"><DialogTitle>{picker?.line ? `选择${picker ? categoryNames[picker.category] : "主材"}型号` : `添加${picker ? categoryNames[picker.category] : "主材"}`}</DialogTitle><DialogDescription>{picker?.line ? `${formatMainMaterialScopeName(picker.line.scopeName)} · ${picker.line.demandName}${picker.line.demandSpec ? ` · 目标规格 ${picker.line.demandSpec}` : ""}` : "仅显示当前已发布版本中可用的商品。"}</DialogDescription></DialogHeader>
          <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,630px)_minmax(360px,1fr)]">
            <div className="min-h-0 overflow-y-auto border-r border-border p-4">
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                <NativeSelect aria-label="筛选品类" onChange={(event) => { setItemName(event.target.value); setBrand(""); setSeries(""); setCandidatePage(1); }} value={itemName}><option value="">品类：全部</option>{itemNames.map((value) => <option key={value} value={value}>{value}</option>)}</NativeSelect>
                <NativeSelect aria-label="筛选品牌" onChange={(event) => { setBrand(event.target.value); setSeries(""); setCandidatePage(1); }} value={brand}><option value="">品牌：全部</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</NativeSelect>
                <NativeSelect aria-label="筛选系列" onChange={(event) => { setSeries(event.target.value); setCandidatePage(1); }} value={series}><option value="">系列 / 工艺：全部</option>{seriesOptions.map((value) => <option key={value} value={value}>{value}</option>)}</NativeSelect>
                <div className="relative"><Search className="absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" onChange={(event) => { setQuery(event.target.value); setCandidatePage(1); }} placeholder="搜索型号或名称" value={query} /></div>
              </div>
              <div className="mb-3 flex items-center justify-between gap-2"><span className="type-support text-muted-foreground">兼容型号 · 共 {candidates.length} 个结果</span>{query || itemName || brand || series ? <Button onClick={() => { setQuery(""); setItemName(""); setBrand(""); setSeries(""); setCandidatePage(1); }} size="sm" variant="ghost">清除筛选</Button> : null}</div>
              <div className="grid gap-2 sm:grid-cols-2">{visibleCandidates.map((group) => <ItemCard active={selectedItem ? mainMaterialCandidateKey(selectedItem) === group.key : false} canViewCosts={canViewCosts} item={group.primary} key={group.key} onSelect={() => selectCandidate(group.variants[0] as MainMaterialItemView)} />)}</div>
              {!candidates.length ? <div className="grid justify-items-center gap-3 py-12 text-center text-muted-foreground"><p className="type-body m-0">没有符合当前规格或筛选条件的可选商品</p><Button onClick={() => { setQuery(""); setItemName(""); setBrand(""); setSeries(""); setCandidatePage(1); }} size="sm" variant="outline">清除筛选</Button></div> : null}
              {candidatePageCount > 1 ? <div className="mt-4 flex items-center justify-center gap-2"><Button aria-label="上一页" disabled={candidatePage === 1} onClick={() => setCandidatePage((page) => Math.max(1, page - 1))} size="icon" variant="outline"><ChevronLeft /></Button><span className="type-support">第 {candidatePage} / {candidatePageCount} 页</span><Button aria-label="下一页" disabled={candidatePage === candidatePageCount} onClick={() => setCandidatePage((page) => Math.min(candidatePageCount, page + 1))} size="icon" variant="outline"><ChevronRight /></Button></div> : null}
            </div>
            <div className="min-h-0 overflow-y-auto p-4"><div className="mb-3 flex items-center justify-between"><h3 className="type-section-title">商品详情</h3>{selectedItem ? <Badge variant="success">ACTIVE</Badge> : null}</div>{selectedItem ? <ItemDetail canViewCosts={canViewCosts} color={color} frameColor={frameColor} glassColor={glassColor} item={selectedItem} key={selectedItem.id} quantity={quantity} setColor={setColor} setFrameColor={setFrameColor} setGlassColor={setGlassColor} setItem={setSelectedItem} setQuantity={setQuantity} showQuantity={!picker?.line || picker.line.origin === "MANUAL"} variants={compatibleGroups.find((group) => group.key === mainMaterialCandidateKey(selectedItem))?.variants ?? [selectedItem]} /> : <div className="grid h-full min-h-64 place-items-center text-center text-muted-foreground"><div><ImageIcon className="mx-auto mb-2 size-8" /><p className="type-body m-0">选择左侧商品查看图片与详情</p></div></div>}</div>
          </div>
          {error ? <p className="type-support m-0 bg-destructive-soft px-5 py-2 text-destructive" role="alert">{error}</p> : null}
          <DialogFooter className="border-t border-border px-5 py-4"><Button disabled={working} onClick={() => setPicker(null)} variant="outline">取消</Button><Button disabled={!selectedItem || working || selectionIncomplete || Boolean((!picker?.line || picker.line.origin === "MANUAL") && Number(quantity) <= 0)} onClick={saveSelection}>{working ? "正在保存…" : "确认选择"}</Button></DialogFooter>
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
  const displayModel = mainMaterialDisplayModel(item);
  const image = mainMaterialProductAsset(item);
  const unit = formatMainMaterialUnit(item.unit);
  return <button className={cn("grid min-h-36 grid-cols-[104px_minmax(0,1fr)] overflow-hidden rounded-lg border bg-background p-2 text-left transition", active ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50 hover:bg-muted/20")} onClick={onSelect} type="button"><div className="relative h-full min-h-32 overflow-hidden rounded-md bg-muted">{image ? <Image alt={`${item.brand} ${item.model}`} className="object-cover" fill sizes="104px" src={`${apiUrl}${image.path}`} unoptimized /> : <div className="grid h-full place-items-center text-muted-foreground"><ImageIcon /></div>}</div><div className="grid min-w-0 content-start gap-1.5 px-3 py-1"><span className="type-support truncate text-success">{item.brand || "ACTIVE"}</span><strong className="truncate text-sm">{displayModel}</strong><span className="line-clamp-2 text-xs text-muted-foreground">{item.itemName}{item.series ? ` · ${item.series}` : ""}</span><span className="truncate text-xs text-muted-foreground">{item.spec || "—"}</span><strong className="mt-1 text-sm text-primary">{item.salePrice ? `${money(item.salePrice)}/${unit}` : "待补"}</strong>{canViewCosts && item.costPrice ? <span className="text-xs text-muted-foreground">成本 {money(item.costPrice)}/{unit}</span> : null}</div></button>;
}

function ItemDetail({ canViewCosts, item, color, frameColor, glassColor, quantity, setColor, setFrameColor, setGlassColor, setItem, setQuantity, showQuantity, variants }: { readonly canViewCosts: boolean; readonly item: MainMaterialItemView; readonly color: string; readonly frameColor: string; readonly glassColor: string; readonly quantity: string; readonly setColor: (value: string) => void; readonly setFrameColor: (value: string) => void; readonly setGlassColor: (value: string) => void; readonly setItem: (item: MainMaterialItemView) => void; readonly setQuantity: (value: string) => void; readonly showQuantity: boolean; readonly variants: readonly MainMaterialItemView[] }) {
  const [selectedAssetId, setSelectedAssetId] = useState(item.assets[0]?.id ?? "");
  const [imageOpen, setImageOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const mappedColorAsset = mainMaterialColorAsset(item, color);
  const glassColors = mainMaterialGlassColors(item);
  const showerTypes = mainMaterialShowerTypes(item);
  const showerSelection = decodeMainMaterialShowerSelection(color);
  const mappedGlassColorAsset = mainMaterialGlassColorAsset(item, glassColor);
  const productAsset = mainMaterialProductAsset(item);
  const image = isLange34A(item) ? productAsset : item.categoryCode === "GLASS_DOOR"
    ? mappedGlassColorAsset ?? productAsset
    : mappedColorAsset ?? item.assets.find((asset) => asset.id === selectedAssetId) ?? item.assets[0];
  const hasIndexedColorAssets = Boolean(
    item.attributes.colorAssetMap || item.attributes.glassColorAssetMap,
  );

  function selectVariant(value: string) {
    const next = findMainMaterialVariant(variants, value);
    if (!next) return;
    setColor(value);
    setItem(next);
    setColorOpen(false);
  }

  const detail = <div className="grid gap-4">
    {image ? <button aria-label="查看高清产品图" className="group relative h-[214px] overflow-hidden rounded-lg bg-muted" onClick={() => setImageOpen(true)} type="button"><Image alt={`${item.brand} ${item.model}`} className="object-contain" fill sizes="474px" src={`${apiUrl}${image.path}`} unoptimized /><span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-xs opacity-0 shadow-sm transition group-hover:opacity-100"><ZoomIn className="size-3.5" />查看大图</span></button> : <div className="grid h-[214px] place-items-center rounded-lg bg-muted text-muted-foreground"><ImageIcon /></div>}
    {!hasIndexedColorAssets && item.assets.length > 1 ? <div className="flex gap-2 overflow-x-auto">{item.assets.slice(0, 6).map((asset) => <button aria-label="查看商品附图" className={cn("relative size-16 shrink-0 overflow-hidden rounded border", image?.id === asset.id ? "border-primary ring-2 ring-primary/20" : "border-border")} key={asset.id} onClick={() => setSelectedAssetId(asset.id)} type="button"><Image alt="商品附图" className="object-contain" fill sizes="64px" src={`${apiUrl}${asset.path}`} unoptimized /></button>)}</div> : null}
    <div><h3 className="type-entity">{item.brand || item.itemName}</h3><p className="type-body m-0 text-muted-foreground">{item.series} {mainMaterialDisplayModel(item)}</p></div>
    {item.attributes.configurationDescription ? <p className="type-body m-0 whitespace-normal break-words">{item.attributes.configurationDescription}</p> : null}
    <div className="grid grid-cols-2 gap-2 text-sm"><Detail label="品名" value={item.itemName} /><Detail label="规格" value={item.spec} /><Detail label="单位" value={formatMainMaterialUnit(item.unit)} /><Detail label="销售价" value={item.salePrice ? money(item.salePrice) : "待补"} />{canViewCosts && item.costPrice ? <Detail label="成本价" value={money(item.costPrice)} /> : null}{visibleMainMaterialAttributes(item.attributes).slice(0, 6).map(([key, value]) => <Detail key={key} label={attributeLabel(key)} value={value} />)}</div>
    {showerTypes.length ? <div className="grid gap-3">
      {isLange34A(item) ? <fieldset className="grid gap-1.5"><legend className="mb-1.5 text-sm font-medium">移门类型 *</legend><div className="flex flex-wrap gap-2">{showerTypes.map((type) => <label className={cn("flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm", showerSelection.type === type ? "border-primary bg-primary-soft text-primary" : "border-border bg-background")} key={type}><input checked={showerSelection.type === type} className="size-3.5 accent-primary" name="lange-34a-type" onChange={() => setColor(encodeMainMaterialShowerSelection(type, showerSelection.color))} required type="radio" value={type} />{type}</label>)}</div>{!showerSelection.type ? <span className="text-xs text-muted-foreground">请选择移门类型</span> : null}</fieldset> : <label className="grid gap-1.5 text-sm font-medium">类型<NativeSelect className="h-10 font-normal" value={showerSelection.type} onChange={(event) => setColor(encodeMainMaterialShowerSelection(event.target.value, showerSelection.color))}><option value="">请选择类型</option>{showerTypes.map((type) => <option key={type} value={type}>{type}</option>)}</NativeSelect></label>}
      <IndexedColorPicker assetFor={(candidate) => mainMaterialColorAsset(item, candidate)} label="颜色" options={item.colors} value={showerSelection.color} onChange={(value) => setColor(encodeMainMaterialShowerSelection(showerSelection.type, value))} />
    </div> : null}
    {!showerTypes.length ? <>
    {variants.length > 1 ? item.attributes.variantGroup?.startsWith("定制浴室柜:") ? <div className="grid gap-1.5 text-sm font-medium"><span>颜色</span><Popover onOpenChange={setColorOpen} open={colorOpen}><PopoverTrigger asChild><Button className="h-10 justify-between font-normal" variant="outline"><span>{color || "请选择颜色"}</span><ChevronDown className="size-4 text-muted-foreground" /></Button></PopoverTrigger><PopoverContent align="start" className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1">{variants.map((variant) => { const candidate = mainMaterialVariantColor(variant); const swatch = variant.assets[0]; return <button className={cn("flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted", color === candidate && "bg-primary-soft text-primary")} key={variant.id} onClick={() => selectVariant(candidate)} type="button"><span>{candidate}</span>{swatch ? <span className="relative size-9 shrink-0 overflow-hidden rounded border border-border"><Image alt={`${candidate}色卡`} className="object-contain" fill sizes="36px" src={`${apiUrl}${swatch.path}`} unoptimized /></span> : <span className="grid size-9 place-items-center rounded border border-dashed text-xs text-muted-foreground">无图</span>}</button>; })}</PopoverContent></Popover></div> : <label className="grid gap-1.5 text-sm font-medium">颜色<NativeSelect className="h-10 font-normal" onChange={(event) => selectVariant(event.target.value)} value={color}><option value="">请选择颜色</option>{variants.map((variant) => { const candidate = mainMaterialVariantColor(variant); return <option key={variant.id} value={candidate}>{candidate}</option>; })}</NativeSelect></label> : item.categoryCode === "GLASS_DOOR" && (glassColors.length || item.colors.length) ? <div className="grid gap-3">{item.colors.length ? <IndexedColorPicker assetFor={(candidate) => mainMaterialColorAsset(item, candidate)} label="门框颜色" onChange={setFrameColor} options={item.colors} value={frameColor} /> : null}{glassColors.length ? <IndexedColorPicker assetFor={(candidate) => mainMaterialGlassColorAsset(item, candidate)} label="玻璃颜色" onChange={setGlassColor} options={glassColors} value={glassColor} /> : null}</div> : item.colors.length ? <label className="grid gap-1.5 text-sm font-medium">颜色<NativeSelect className="h-10 font-normal" onChange={(event) => setColor(event.target.value)} value={color}><option value="">请选择颜色</option>{item.colors.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</NativeSelect></label> : null}
    </> : null}
    {showQuantity ? <label className="grid gap-1.5 text-sm font-medium">数量<Input inputMode="decimal" min="0" onChange={(event) => setQuantity(event.target.value)} value={quantity} /></label> : null}
  </div>;

  return <>{detail}<Dialog onOpenChange={setImageOpen} open={imageOpen}><DialogContent className="max-w-[min(94vw,1400px)] p-4"><DialogHeader className="sr-only"><DialogTitle>查看高清产品图</DialogTitle><DialogDescription>{item.brand} {item.model}</DialogDescription></DialogHeader>{image ? <div className="relative h-[80vh] w-full bg-muted"><Image alt={`${item.brand} ${item.model}高清产品图`} className="object-contain" fill sizes="94vw" src={`${apiUrl}${image.path}`} unoptimized /></div> : null}</DialogContent></Dialog></>;
}

function IndexedColorPicker({ assetFor, label, onChange, options, value }: { readonly assetFor: (value: string) => MainMaterialItemView["assets"][number] | undefined; readonly label: string; readonly onChange: (value: string) => void; readonly options: readonly string[]; readonly value: string }) {
  const [open, setOpen] = useState(false);
  return <div className="grid gap-1.5 text-sm font-medium"><span>{label}</span><Popover onOpenChange={setOpen} open={open}><PopoverTrigger asChild><Button className="h-10 justify-between font-normal" variant="outline"><span>{value || `请选择${label}`}</span><ChevronDown className="size-4 text-muted-foreground" /></Button></PopoverTrigger><PopoverContent align="start" className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1">{options.map((candidate) => { const swatch = assetFor(candidate); return <button className={cn("flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted", value === candidate && "bg-primary-soft text-primary")} key={candidate} onClick={() => { onChange(candidate); setOpen(false); }} type="button"><span>{candidate}</span>{swatch ? <span className="relative size-9 shrink-0 overflow-hidden rounded border border-border"><Image alt={`${candidate}色卡`} className="object-contain" fill sizes="36px" src={`${apiUrl}${swatch.path}`} unoptimized /></span> : <span className="grid size-9 place-items-center rounded border border-dashed text-xs text-muted-foreground">无图</span>}</button>; })}</PopoverContent></Popover></div>;
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) { return <div className="rounded-md bg-muted px-3 py-2"><span className="block text-xs text-muted-foreground">{label}</span><strong className="mt-0.5 block font-medium">{value || "—"}</strong></div>; }
function Summary({ emphasis = false, label, value }: { readonly emphasis?: boolean; readonly label: string; readonly value: string }) { return <div className="flex items-center justify-between gap-2"><span className="type-table-body text-muted-foreground">{label}</span><strong className={emphasis ? "text-xl text-primary" : "text-base"}>{money(value)}</strong></div>; }
function money(value: string) { return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function formatPercent(value: number) { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4))); }
function sortedUnique(values: readonly string[]) { return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN")); }
function floorBrandRank(value: string) { return ({ "北极鹿": 0, "乔艺": 1, "辅材": 2 } as Record<string, number>)[value] ?? 3; }
function attributeLabel(value: string) { return ({ type: "类型", woodSpecies: "木种", substrate: "基材", thickness: "厚度", grade: "等级", lockType: "锁扣", packaging: "包装", panelSize: "面板尺寸", lightingPower: "照明功率" } as Record<string, string>)[value] ?? value; }
