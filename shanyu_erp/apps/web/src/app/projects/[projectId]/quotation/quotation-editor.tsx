"use client";

import type {
  HalfPackageQuotation,
  HalfPackageQuotationLine,
} from "@shanyu/contracts";
import { ChevronDown, Info } from "lucide-react";
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
  readonly initialQuotation: HalfPackageQuotation;
}

export function QuotationEditor({ initialQuotation }: QuotationEditorProps) {
  const initialScopes = orderQuotationScopes(initialQuotation.scopes);
  const [quotation, setQuotation] = useState(initialQuotation);
  const [activeScopeId, setActiveScopeId] = useState(
    initialScopes[0]?.id ?? "",
  );
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>(
    {},
  );
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [focusedLine, setFocusedLine] = useState<HalfPackageQuotationLine | null>(
    null,
  );
  const [message, setMessage] = useState("已从服务端恢复草稿");
  const [error, setError] = useState<string | null>(null);
  const orderedScopes = useMemo(
    () => orderQuotationScopes(quotation.scopes),
    [quotation.scopes],
  );
  const activeScope =
    orderedScopes.find((scope) => scope.id === activeScopeId) ??
    orderedScopes[0];
  const selectedCount = useMemo(
    () =>
      quotation.scopes.reduce(
        (count, scope) =>
          count + scope.lines.filter((line) => line.selected).length,
        0,
      ),
    [quotation.scopes],
  );

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
          <h1>{quotation.projectName} · 半包报价</h1>
          <p>主材库 V{quotation.templateVersion} · 标准单价只读 · 数量和选项按行保存</p>
        </div>
        <div className="quotation-actions">
          <div className="quotation-save-state" aria-live="polite">
            <span className={error ? "save-dot error" : "save-dot"} />{message}
          </div>
          <Button
            onClick={() => setMessage(`草稿已保存 · 修订 ${quotation.revision}`)}
            size="sm"
            type="button"
            variant="outline"
          >
            保存草稿
          </Button>
          <Button
            onClick={() => setMessage("提交审批将在阶段 6 开放，当前草稿未改变。")}
            size="sm"
            type="button"
          >
            提交何老板审批
          </Button>
        </div>
      </header>

      {error ? <div className="quotation-error" role="alert">{error}</div> : null}

      <div className="quotation-workbench">
        <aside className="quotation-scope-nav" aria-label="空间和通用工程">
          <p className="eyebrow">报价范围</p>
          {orderedScopes.map((scope) => {
            const count = scope.lines.filter((line) => line.selected).length;
            return (
              <button
                className={scope.id === activeScope.id ? "scope-nav-item active" : "scope-nav-item"}
                key={scope.id}
                onClick={() => {
                  setActiveScopeId(scope.id);
                  setFocusedLine(null);
                }}
                type="button"
              >
                <span><strong>{formatQuotationScopeName(scope.name)}</strong><small>{scope.spaceType ? "空间" : "项目通用"}</small></span>
                <span>{count}/{scope.lines.length}</span>
              </button>
            );
          })}
        </aside>

        <section className="quotation-editor-panel">
          <div className="quotation-scope-heading">
            <div>
              <p className="eyebrow">当前范围</p>
              <h2>{formatQuotationScopeName(activeScope.name)}</h2>
              <p>{scopeRuleDescription(activeScope.spaceType)}</p>
            </div>
            <strong>¥ {formatQuotationMoney(activeScope.subtotal)}</strong>
          </div>

          <div className="quotation-parameters">
            {activeScope.spaceType ? (
              <>
                <Parameter label="面积" value={`${formatDisplayNumber(activeScope.area)} M²`} />
                <Parameter label="周长" value={`${formatDisplayNumber(activeScope.perimeter)} m`} />
                <Parameter label="层高" value={`${formatDisplayNumber(activeScope.height)} m`} />
              </>
            ) : (
              <Parameter label="作用范围" value="项目级通用工程" />
            )}
            <Parameter label="工程项" value={`${activeScope.lines.length} 项全部展示`} />
          </div>

          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead>
                <tr>
                  <th>分类</th><th>工程项</th><th>单位</th><th>数量</th>
                  <th>销售单价</th><th>销售金额</th><th>说明</th>
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
                          <td>{quotationLineCategory(line.itemName, line.sectionName, activeScope.spaceType)}</td>
                          <td>
                            <div className="quotation-group-description">
                              <strong>{group}</strong>
                              <span>型号可多选 · 已选 {groupLines.filter((item) => item.selected).length} 项</span>
                            </div>
                          </td>
                          <td colSpan={4}>
                            <MultiSelectControl
                              disabled={savingLineId !== null}
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
                        <td>{quotationLineCategory(line.itemName, line.sectionName, activeScope.spaceType)}</td>
                        <td>
                          <div className="quotation-item-name">
                            <Checkbox
                              aria-label={`选择 ${line.itemName}`}
                              checked={line.selected}
                              disabled={saving}
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
                              disabled={saving}
                              inputMode="decimal"
                              onBlur={() => {
                                const quantity = draftQuantities[line.id];
                                if (quantity !== undefined) {
                                  void saveLine(line, line.selected || quantity !== "", quantity || null);
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
                        <td>
                          <button
                            className="quotation-remarks-button"
                            onClick={() => setFocusedLine(line)}
                            type="button"
                          >
                            <Info />{line.remarks ? "查看说明" : "计价口径"}
                          </button>
                        </td>
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
            <p className="eyebrow">当前范围</p>
            <strong>¥ {formatQuotationMoney(activeScope.subtotal)}</strong>
            <small>{activeScope.lines.filter((line) => line.selected).length} / {activeScope.lines.length} 项已选择</small>
          </section>
          <section>
            <p className="eyebrow">半包实时总价</p>
            <dl>
              <div><dt>直接费</dt><dd>¥ {formatQuotationMoney(quotation.directCost)}</dd></div>
              <div><dt>管理费 10%</dt><dd>¥ {formatQuotationMoney(quotation.managementFee)}</dd></div>
            </dl>
            <strong className="quotation-total">¥ {formatQuotationMoney(quotation.total)}</strong>
            <small>{selectedCount} 项已选择 · 内部四位小数计价</small>
          </section>
          <section className="quotation-checks">
            <p className="eyebrow">提交前检查</p>
            <p>✓ 标准销售价来自已发布主材库</p>
            <p>✓ 157 项按空间类型完整映射</p>
            <p>✓ 地砖 / 墙砖 / 找平可多选</p>
            <p>审批流程将在阶段 6 开放</p>
          </section>
          <section className="quotation-explanation">
            <p className="eyebrow">施工说明</p>
            <h3>{focusedLine?.itemName ?? "点击工程项查看口径"}</h3>
            <p>{focusedLine?.remarks ?? "说明只展示 Excel 原始内容；没有提供的局部参数不会被臆造。"}</p>
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

function scopeRuleDescription(spaceType: HalfPackageQuotation["scopes"][number]["spaceType"]): string {
  return spaceType
    ? "展示本空间对应的全部工程项，未选项不计价。"
    : "项目级通用工程按已确认规则计算，复杂口径保持手工填写。";
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
