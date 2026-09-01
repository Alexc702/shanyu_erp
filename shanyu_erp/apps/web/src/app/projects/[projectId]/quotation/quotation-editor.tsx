"use client";

import type {
  HalfPackageQuotation,
  HalfPackageQuotationLine,
  HalfPackageQuotationScope,
} from "@shanyu/contracts";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatQuotationMoney,
  quotationLineUpdateForQuantity,
  saveQuotationLine,
} from "@/lib/quotation-client";
import {
  formatDisplayNumber,
  formatQuotationScopeName,
  formatQuotationUnit,
  orderQuotationScopes,
  quotationLineCategory,
  quotationOptionGroup,
  quotationOptionModelLabel,
  quotationOptionQuantityForToggle,
  shouldDisplayQuotationOptionLine,
} from "@/lib/quotation-view-model";

interface QuotationEditorProps {
  readonly buildingArea: string;
  readonly canViewCosts: boolean;
  readonly initialQuotation: HalfPackageQuotation;
  readonly leadDesignerName: string;
}

export function QuotationEditor({
  buildingArea,
  canViewCosts,
  initialQuotation,
  leadDesignerName,
}: QuotationEditorProps) {
  const initialScopes = orderQuotationScopes(initialQuotation.scopes);
  const [quotation, setQuotation] = useState(initialQuotation);
  const [activeScopeId, setActiveScopeId] = useState(
    initialScopes[0]?.id ?? "",
  );
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>(
    {},
  );
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [message, setMessage] = useState("已从服务端恢复草稿");
  const [error, setError] = useState<string | null>(null);
  const editable = quotation.status === "DRAFT";
  const orderedScopes = useMemo(
    () => orderQuotationScopes(quotation.scopes),
    [quotation.scopes],
  );
  const activeScope =
    orderedScopes.find((scope) => scope.id === activeScopeId) ??
    orderedScopes[0];

  async function saveLine(
    line: HalfPackageQuotationLine,
    selected: boolean,
    quantity: string | null,
  ) {
    setSavingLineId(line.id);
    setError(null);
    setMessage("正在保存…");
    try {
      const saved = await saveQuotationLine(quotation.projectId, line.id, {
        expectedRevision: quotation.revision,
        quantity,
        selected,
      });
      setQuotation(saved);
      setDraftQuantities((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      setMessage(`已保存 · 修订 ${saved.revision}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试");
      setMessage("保存失败");
    } finally {
      setSavingLineId(null);
    }
  }

  if (!activeScope) {
    return (
      <main className="page-content">
        <section className="panel empty-panel">
          <h1>当前项目没有可报价空间</h1>
        </section>
      </main>
    );
  }

  const renderedGroups = new Set<string>();

  return (
    <main className="quotation-page">
      <header className="quotation-header">
        <div>
          <nav className="quotation-breadcrumb" aria-label="面包屑">
            <Link href={`/projects/${quotation.projectId}`}>{quotation.projectName}</Link>
            <span>/</span><span>半包报价</span><span>/</span><strong>{formatQuotationScopeName(activeScope.name)}</strong>
          </nav>
          <h1>{quotationScopeTitle(activeScope)}</h1>
          <p>{scopeRuleDescription(activeScope)}</p>
        </div>
        <div className="quotation-actions">
          <div className="quotation-save-state" aria-live="polite">
            <span className={error ? "save-dot error" : "save-dot"} />{message}
          </div>
          {editable ? (
            <Button
              onClick={() => setMessage(`草稿已保存 · 修订 ${quotation.revision}`)}
              size="sm"
              type="button"
              variant="outline"
            >
              保存草稿
            </Button>
          ) : null}
          {canViewCosts ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/projects/${quotation.projectId}/quotation/cost-margin`}>
                查看预计成本毛利
              </Link>
            </Button>
          ) : null}
          {editable ? (
            <Button asChild size="sm">
              <Link href={`/projects/${quotation.projectId}/quotation/submit`}>
                提交何老板审批
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href={`/projects/${quotation.projectId}/quotation/versions`}>
                查看版本记录
              </Link>
            </Button>
          )}
        </div>
      </header>

      {error ? <div className="quotation-error" role="alert">{error}</div> : null}

      <div className="quotation-workbench">
        <aside className="quotation-scope-nav" aria-label="空间和通用工程">
          <p className="eyebrow">空间 / 通用工程</p>
          {orderedScopes.map((scope) => {
            return (
              <button
                className={scope.id === activeScope.id ? "scope-nav-item active" : "scope-nav-item"}
                key={scope.id}
                onClick={() => {
                  setActiveScopeId(scope.id);
                }}
                type="button"
              >
                <span><strong>{formatQuotationScopeName(scope.name)}</strong><small>{scope.spaceType ? "空间" : "项目通用"}</small></span>
                <span>{scopeItemCountLabel(scope)}</span>
              </button>
            );
          })}
        </aside>

        <section className="quotation-editor-panel">
          <div className="quotation-parameters-card">
            <div className="quotation-parameters-title">
              <h2>{formatQuotationScopeName(activeScope.name)}参数</h2>
              <span
                className={error ? "quotation-auto-save error" : "quotation-auto-save"}
                aria-live="polite"
              >
                {error ? "保存失败" : savingLineId ? "正在保存…" : "自动保存"}
              </span>
            </div>
            <div className="quotation-parameters">
              {scopeParameters(
                activeScope,
                buildingArea,
                quotation.templateVersion,
                leadDesignerName,
              ).map((parameter) => (
                <Parameter
                  key={parameter.label}
                  label={parameter.label}
                  value={parameter.value}
                />
              ))}
            </div>
          </div>

          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <colgroup>
                <col className="quotation-col-select" />
                <col className="quotation-col-category" />
                <col className="quotation-col-item" />
                <col className="quotation-col-unit" />
                <col className="quotation-col-quantity" />
                <col className="quotation-col-price" />
                <col className="quotation-col-amount" />
                <col className="quotation-col-remarks" />
              </colgroup>
              <thead>
                <tr>
                  <th aria-label="选择" />
                  <th>分类</th><th>工程项目</th><th>单位</th><th>数量</th>
                  <th>单价</th><th>金额</th><th>施工说明</th>
                </tr>
              </thead>
              <tbody>
                {activeScope.lines.map((line) => {
                  const automatic = line.quantitySource !== "MANUAL";
                  const hasDraftQuantity = Object.hasOwn(draftQuantities, line.id);
                  const draftValue = hasDraftQuantity
                    ? (draftQuantities[line.id] ?? "")
                    : line.quantity
                      ? formatDisplayNumber(line.quantity)
                      : "";
                  const saving = savingLineId === line.id;
                  const group = quotationOptionGroup(line.itemName);
                  const showGroup = group !== null && !renderedGroups.has(group);
                  if (group) renderedGroups.add(group);
                  const groupLines = group
                    ? activeScope.lines.filter((item) => quotationOptionGroup(item.itemName) === group)
                    : [];
                  return (
                    <Fragment key={line.id}>
                      {showGroup && group ? (
                        <tr className="quotation-group-row">
                          <td className="quotation-group-category" colSpan={2}>
                            {quotationLineCategory(line.itemName, line.sectionName, activeScope.spaceType)}
                          </td>
                          <td>
                            <div className="quotation-group-description">
                              <strong>{optionGroupTitle(group)}</strong>
                              <span>{optionGroupSelectionLabel(group)} · 已选 {groupLines.filter((item) => item.selected).length} 项</span>
                            </div>
                          </td>
                          <td colSpan={4}>
                            <MultiSelectControl
                              disabled={savingLineId !== null || !editable}
                              lines={groupLines}
                              onToggle={(selectedLine, checked) =>
                                saveLine(
                                  selectedLine,
                                  checked,
                                  quotationOptionQuantityForToggle(
                                    selectedLine.quantity,
                                    checked,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="quotation-group-hint">选中型号后逐行填写数量</td>
                        </tr>
                      ) : null}
                      {shouldDisplayQuotationOptionLine(
                        line.itemName,
                        line.selected,
                      ) ? (
                      <tr className={line.selected ? "selected" : ""}>
                        <td className="quotation-selection-cell">
                          <Checkbox
                            aria-label={`选择 ${line.itemName}`}
                            checked={line.selected}
                            disabled={saving || !editable}
                            onCheckedChange={(checked) =>
                              saveLine(
                                line,
                                checked === true,
                                automatic || checked !== true
                                  ? null
                                  : (draftQuantities[line.id] ?? line.quantity),
                              )
                            }
                          />
                        </td>
                        <td>{quotationLineCategory(line.itemName, line.sectionName, activeScope.spaceType)}</td>
                        <td>
                          <div className="quotation-item-name">
                            <span><strong>{line.itemName}</strong>{automatic ? <small>{quantitySourceLabel(line.quantitySource)}</small> : null}</span>
                          </div>
                        </td>
                        <td>{formatQuotationUnit(line.unit)}</td>
                        <td>
                          {automatic ? (
                            <span className="automatic-quantity">{formatDisplayNumber(line.quantity)}</span>
                          ) : (
                            <input
                              aria-label={`${line.itemName} 数量`}
                              className="quantity-input"
                              disabled={saving || !editable}
                              inputMode="decimal"
                              onBlur={() => {
                                const quantity = draftQuantities[line.id];
                                if (quantity !== undefined) {
                                  const update = quotationLineUpdateForQuantity(quantity);
                                  void saveLine(line, update.selected, update.quantity);
                                }
                              }}
                              onChange={(event) =>
                                setDraftQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                              }
                              placeholder="填写"
                              value={draftValue}
                            />
                          )}
                        </td>
                        <td>¥ {formatQuotationMoney(line.saleUnitPrice)}</td>
                        <td className="quotation-amount">{line.amount ? `¥ ${formatQuotationMoney(line.amount)}` : "—"}</td>
                        <td className="quotation-remarks">{line.remarks ?? "—"}</td>
                      </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="quotation-summary">
          <section>
            <p className="quotation-summary-title">当前分区</p>
            <strong>已计价 ¥ {formatQuotationMoney(activeScope.subtotal)}</strong>
            <small>{emptyQuantityCount(activeScope)} 项数量为空＝{emptyQuantityNote(activeScope)}</small>
          </section>
          <section>
            <p className="quotation-total-label">半包实时总价</p>
            <strong className="quotation-total">¥ {formatQuotationMoney(quotation.total)}</strong>
          </section>
        </aside>
      </div>
    </main>
  );
}

function MultiSelectControl({
  disabled,
  lines,
  onToggle,
}: {
  readonly disabled: boolean;
  readonly lines: readonly HalfPackageQuotationLine[];
  readonly onToggle: (line: HalfPackageQuotationLine, checked: boolean) => void;
}) {
  const selected = lines.filter((line) => line.selected);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="multi-select-trigger" disabled={disabled} type="button">
          <span className="multi-select-value">
            {selected.length
              ? selected.map((line) => (
                  <span className="multi-select-tag" key={line.id}>
                    {quotationOptionModelLabel(line.itemName)}
                  </span>
                ))
              : "请选择（可多选）"}
          </span>
          <ChevronDown />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="multi-select-popover">
        <div className="multi-select-list">
          {lines.map((line) => (
            <label className="multi-select-option" key={line.id}>
              <Checkbox
                checked={line.selected}
                disabled={disabled}
                onCheckedChange={(checked) => onToggle(line, checked === true)}
              />
              <span>{line.itemName}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Parameter({ label, value }: { readonly label: string; readonly value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function scopeRuleDescription(scope: HalfPackageQuotationScope): string {
  const sectionName = primarySectionName(scope);
  if (sectionName.includes("砌墙工程")) {
    return "数量默认留空，由主案设计师按实际工程填写";
  }
  if (sectionName.includes("客餐厅工程")) {
    return hasIncludedBalconyItems(scope)
      ? "地砖、墙砖、找平均可多选；每一行独立填写数量并计价，包阳台项单独归属客餐厅"
      : "地砖、墙砖、找平均可多选；每一行独立填写数量并计价";
  }
  if (sectionName.includes("卧室工程")) {
    return "所有卧室共用同一模板；地砖、墙砖、找平均可多选并分别计量";
  }
  if (sectionName.includes("厨卫工程")) {
    return "厨房、主卫、公卫共用半包工程项目模板；不需要的项目保持数量为空";
  }
  if (sectionName.includes("阳台工程")) {
    return "独立阳台与客餐厅包阳台分别归属、计量、汇总和导出";
  }
  if (sectionName.includes("油漆工程")) {
    return "3 项数量均直接读取项目建筑面积";
  }
  if (sectionName.includes("水电工程")) {
    return "面积型项目读取建筑面积；其余项目数量留空，由主案设计师按方案填写";
  }
  return "第 1 项按实际车数手填；第 2、3 项按项目建筑面积自动填写";
}

function quotationScopeTitle(scope: HalfPackageQuotationScope): string {
  const sectionName = primarySectionName(scope);
  if (!scope.spaceType) return sectionName;
  if (scope.spaceType === "LIVING_DINING") {
    return hasIncludedBalconyItems(scope)
      ? `${sectionName}（包阳台）`
      : sectionName;
  }
  if (scope.spaceType === "CLOSET") return "三、衣帽间工程";
  if (sectionName.includes("厨卫工程")) {
    return `八、${formatQuotationScopeName(scope.name)}工程`;
  }
  if (sectionName.includes("阳台工程")) {
    return `七、${formatQuotationScopeName(scope.name)}工程`;
  }
  return sectionName;
}

function scopeParameters(
  scope: HalfPackageQuotationScope,
  buildingArea: string,
  templateVersion: number,
  leadDesignerName: string,
): readonly { readonly label: string; readonly value: string }[] {
  if (scope.spaceType) {
    const parameters = [
      { label: "空间名称", value: formatQuotationScopeName(scope.name) },
      { label: "面积", value: `${formatDisplayNumber(scope.area)}㎡` },
      { label: "周长", value: `${formatDisplayNumber(scope.perimeter)}m` },
      { label: "层高", value: `${formatDisplayNumber(scope.height)}m` },
    ];
    return hasIncludedBalconyItems(scope)
      ? [...parameters, { label: "包阳台", value: "已勾选" }]
      : parameters;
  }

  const sectionName = primarySectionName(scope);
  const common = [
    { label: "作用范围", value: "项目级通用工程" },
    { label: "建筑面积", value: `${formatDisplayNumber(buildingArea)}㎡` },
  ];
  if (sectionName.includes("油漆工程")) {
    return [
      ...common,
      { label: "数量来源", value: "全部自动" },
      { label: "变更规则", value: "面积变化时提示差异" },
    ];
  }
  if (sectionName.includes("水电工程")) {
    return [
      ...common,
      { label: "自动项", value: "第1–6、9项" },
      { label: "其余数量", value: `${leadDesignerName} 手填` },
    ];
  }
  if (sectionName.includes("其他工程")) {
    return [
      ...common,
      { label: "自动项", value: "第2、3项" },
      { label: "手填项", value: "垃圾外运车数" },
    ];
  }
  return [
    ...common,
    { label: "数量规则", value: "全部手填" },
    { label: "模板版本", value: `半包 V${templateVersion}` },
  ];
}

function primarySectionName(scope: HalfPackageQuotationScope): string {
  return scope.lines[0]?.sectionName ?? scope.name;
}

function hasIncludedBalconyItems(scope: HalfPackageQuotationScope): boolean {
  return scope.lines.some((line) => line.sectionName.includes("阳台工程"));
}

function scopeItemCountLabel(scope: HalfPackageQuotationScope): string {
  const counts = new Map<string, number>();
  for (const line of scope.lines) {
    counts.set(line.sectionName, (counts.get(line.sectionName) ?? 0) + 1);
  }
  return [...counts.values()].join("+");
}

function emptyQuantityCount(scope: HalfPackageQuotationScope): number {
  return scope.lines.filter((line) => line.quantity === null).length;
}

function emptyQuantityNote(scope: HalfPackageQuotationScope): string {
  const sectionName = primarySectionName(scope);
  return sectionName.includes("砌墙工程") || hasIncludedBalconyItems(scope)
    ? "本项目暂不需要"
    : "暂不需要";
}

function optionGroupTitle(
  group: NonNullable<ReturnType<typeof quotationOptionGroup>>,
): string {
  return group === "找平做法" ? "地面找平" : group;
}

function optionGroupSelectionLabel(
  group: NonNullable<ReturnType<typeof quotationOptionGroup>>,
): string {
  return group === "找平做法" ? "做法可多选" : "型号可多选";
}

function quantitySourceLabel(source: HalfPackageQuotationLine["quantitySource"]): string {
  return {
    LINE_REFERENCE: "自动 · 引用工程项",
    MANUAL: "手工填写",
    PROJECT_BUILDING_AREA: "自动 · 项目建筑面积",
    SPACE_AREA: "自动 · 空间面积",
    SPACE_PERIMETER_HEIGHT: "自动 · 周长 × 层高",
  }[source];
}
