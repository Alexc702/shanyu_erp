"use client";

import type {
  AuditEventView,
  HalfPackageExportFormat,
  HalfPackageQuotationVersionSummary,
  HalfPackageVersionDifference,
  ProjectDetail,
  SessionUser,
} from "@shanyu/contracts";
import {
  ArrowLeft,
  ArrowLeftRight,
  Clock3,
  Download,
  Eye,
  FileDown,
  Info,
  LockKeyhole,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiUrl } from "@/lib/api-url";
import { hasOwnerPermissions } from "@/lib/permissions";
import {
  compareQuotationVersions,
  createQuotationExport,
  formatQuotationMoney,
} from "@/lib/quotation-client";
import { formatQuotationScopeName } from "@/lib/quotation-view-model";

interface VersionHistoryProps {
  readonly auditEvents: readonly AuditEventView[];
  readonly currentTemplateVersion: number | null;
  readonly project: ProjectDetail;
  readonly user: SessionUser;
  readonly versions: readonly HalfPackageQuotationVersionSummary[];
}

export function VersionHistory({
  auditEvents,
  currentTemplateVersion,
  project,
  user,
  versions,
}: VersionHistoryProps) {
  const currentVersion = versions[0];
  const [fromId, setFromId] = useState(versions[1]?.id ?? currentVersion.id);
  const [toId, setToId] = useState(currentVersion.id);
  const [differences, setDifferences] = useState<
    readonly HalfPackageVersionDifference[] | null
  >(null);
  const [comparisonLabel, setComparisonLabel] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportable = isApproved(currentVersion.status);
  const versionIds = new Set(versions.map((version) => version.id));
  const projectEvents = auditEvents
    .filter(
      (event) =>
        event.targetType === "HALF_PACKAGE_QUOTATION" &&
        event.targetId !== null &&
        versionIds.has(event.targetId),
    )
    .slice(0, 3);

  async function compare() {
    if (!fromId || !toId || fromId === toId) return;
    setWorking(true);
    setError(null);
    try {
      const result = await compareQuotationVersions(project.id, fromId, toId);
      setDifferences(result.differences);
      setComparisonLabel(`V${result.fromVersion} 与 V${result.toVersion}`);
      document.getElementById("version-differences")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "版本对比失败");
    } finally {
      setWorking(false);
    }
  }

  async function exportFile(
    quotationId: string,
    format: HalfPackageExportFormat,
  ) {
    setWorking(true);
    setError(null);
    try {
      const record = await createQuotationExport(quotationId, format);
      const link = document.createElement("a");
      link.href = `${apiUrl}${record.downloadPath}`;
      link.download = record.fileName;
      link.click();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出失败");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="grid gap-3 p-5 xl:p-7">
      <header className="grid gap-2">
        <Link
          className="type-action inline-flex w-fit items-center gap-1.5 text-muted-foreground hover:text-foreground"
          href={`/projects/${project.id}`}
        >
          <ArrowLeft className="size-3.5" />
          项目管理 / {project.name} / 项目版本管理
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="type-page-title m-0 tracking-tight">项目版本管理</h1>
              <Badge variant="success">{projectStage(currentVersion.status)}</Badge>
              <Badge variant={statusVariant(currentVersion.status)}>
                报价阶段 · {statusLabel(currentVersion.status)}
              </Badge>
            </div>
            <p className="type-support m-0 text-muted-foreground">
              {project.name} · {project.customerName} · 主案 {project.leadDesigner.displayName} ·
              当前有效版本 V{currentVersion.versionNumber}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              className="border-border"
              disabled={versions.length < 2 || working}
              onClick={() =>
                document.getElementById("version-compare")?.scrollIntoView({
                  behavior: "smooth",
                })
              }
              variant="outline"
            >
              <ArrowLeftRight />
              版本对比
            </Button>
            <ExportMenu
              disabled={!exportable || working}
              onExport={(format) => exportFile(currentVersion.id, format)}
            />
          </div>
        </div>
      </header>

      <div className="type-support flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2.5">
        <Info className="size-4 shrink-0 text-primary" />
        <span>
          版本由新建项目、保存草稿、提交审批及审批状态变化自动生成。
        </span>
      </div>

      {error ? (
        <p
          className="type-body m-0 rounded-lg bg-destructive-soft px-3 py-2 text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-0.5">
              <div className="flex items-center gap-2">
                <h2 className="type-section-title m-0">全部版本</h2>
                <Badge variant="secondary">共 {versions.length} 个版本</Badge>
              </div>
              <p className="type-support m-0 text-muted-foreground">
                按生成时间倒序；点击任一版本查看只读快照。
              </p>
            </div>

            <div className="flex items-center gap-1.5" id="version-compare">
              <VersionSelect
                ariaLabel="对比的起始版本"
                onChange={setFromId}
                value={fromId}
                versions={versions}
              />
              <ArrowLeftRight className="size-3.5 text-muted-foreground" />
              <VersionSelect
                ariaLabel="对比的目标版本"
                onChange={setToId}
                value={toId}
                versions={versions}
              />
              <Button
                disabled={working || fromId === toId}
                onClick={compare}
                size="sm"
              >
                开始对比
              </Button>
            </div>
          </div>

          <Card className="overflow-hidden border-border py-0 shadow-none">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-muted">
                  <TableHead>版本</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>生成时间</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead className="min-w-48">变更原因 / 摘要</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((version) => {
                  const event = auditEventForVersion(version, auditEvents);
                  const current = version.id === currentVersion.id;
                  return (
                    <TableRow
                      className={current ? "bg-success-soft/70 hover:bg-success-soft" : undefined}
                      key={version.id}
                    >
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-semibold">
                          V{version.versionNumber}
                          {current ? <Badge variant="success">当前</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(version.status)}>
                          {statusLabel(version.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateTime(event?.occurredAt ?? version.submittedAt)}</TableCell>
                      <TableCell>{event?.actorDisplayName ?? "—"}</TableCell>
                      <TableCell>{sourceVersion(version.versionNumber)}</TableCell>
                      <TableCell className="max-w-64 truncate">
                        {changeSummary(version)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button asChild size="sm" variant="outline">
                            <Link href={snapshotHref(project.id, version.id)}>
                              <Eye />
                              查看快照
                            </Link>
                          </Button>
                          {isApproved(version.status) ? (
                            <ExportMenu
                              compact
                              disabled={working}
                              onExport={(format) => exportFile(version.id, format)}
                            />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="type-support grid gap-1.5 rounded-lg bg-muted px-3 py-2.5 text-muted-foreground">
            <strong className="flex items-center gap-1.5 text-foreground">
              <LockKeyhole className="size-3.5" />
              角色与状态决定可用操作
            </strong>
            <span>
              草稿/已退回：主案继续编辑、保存或提交；待审批：主案可继续编辑并撤回，老板可批准或退回；已审批：仅老板可打回。
            </span>
            <span>审批操作必须校验当前有效版本；对已撤回申请的旧页面操作由服务端拒绝。</span>
          </div>

          {differences ? (
            <Card
              className="scroll-mt-4 border-border py-0 shadow-none"
              id="version-differences"
            >
              <CardContent className="grid gap-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="type-section-title m-0">版本差异</h2>
                  <Badge variant="secondary">
                    {comparisonLabel} · {differences.length} 项
                  </Badge>
                </div>
                {differences.length === 0 ? (
                  <p className="type-body m-0 text-muted-foreground">两个版本无业务差异。</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>空间</TableHead>
                        <TableHead>工程项</TableHead>
                        <TableHead>字段</TableHead>
                        <TableHead>原值</TableHead>
                        <TableHead>新值</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {differences.map((difference, index) => (
                        <TableRow key={`${difference.scopeName}-${difference.itemName}-${difference.field}-${index}`}>
                          <TableCell>{formatQuotationScopeName(difference.scopeName)}</TableCell>
                          <TableCell>{difference.itemName}</TableCell>
                          <TableCell>{fieldLabel(difference.field)}</TableCell>
                          <TableCell>{differenceValue(difference.field, difference.before)}</TableCell>
                          <TableCell>{differenceValue(difference.field, difference.after)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : null}
        </section>

        <aside className="grid gap-3">
          <CurrentVersionCard
            auditEvent={auditEventForVersion(currentVersion, auditEvents)}
            currentTemplateVersion={currentTemplateVersion}
            projectId={project.id}
            user={user}
            version={currentVersion}
          />

          <Card className="border-border py-0 shadow-none">
            <CardContent className="grid gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="type-section-title m-0">客户文件与导出</h2>
                <Badge variant={exportable ? "success" : "secondary"}>
                  {exportable ? "可导出" : "尚未批准"}
                </Badge>
              </div>
              <strong className="type-entity">客户版 PDF / XLSX</strong>
              <p className="type-support m-0 text-muted-foreground">
                项目 {project.name} · 报价 V{currentVersion.versionNumber} · 模板 V
                {currentTemplateVersion ?? "—"}
              </p>
              <div className="type-support flex items-start gap-2 rounded-md bg-info-soft px-2.5 py-2">
                <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>客户文件不包含成本、返点、毛利或内部审批信息。</span>
              </div>
              <ExportMenu
                disabled={!exportable || working}
                fullWidth
                onExport={(format) => exportFile(currentVersion.id, format)}
              />
            </CardContent>
          </Card>

          <Card className="border-border py-0 shadow-none">
            <CardContent className="grid gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="type-section-title m-0">最近操作日志</h2>
                <span className="type-support text-muted-foreground">不可修改</span>
              </div>
              {projectEvents.length ? (
                <div className="divide-y divide-border">
                  {projectEvents.map((event) => (
                    <div className="flex gap-2 py-2.5 first:pt-0" key={event.id}>
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted">
                        <Clock3 className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="type-table-body flex justify-between gap-2">
                          <strong className="truncate">
                            {event.actorDisplayName ?? "系统"} · {auditActionLabel(event.action)}
                          </strong>
                          <time className="type-support shrink-0 text-muted-foreground">
                            {formatShortTime(event.occurredAt)}
                          </time>
                        </div>
                        <p className="type-support m-0 mt-0.5 text-muted-foreground">
                          {auditVersionFlow(event)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="type-support m-0 rounded-md bg-muted px-3 py-4 text-center text-muted-foreground">
                  暂无可显示的项目日志
                </p>
              )}
              {user.role === "ADMIN" ? (
                <Button asChild className="w-full border-border" size="sm" variant="outline">
                  <Link href="/audit">
                    <ScrollText />
                    查看全部操作日志
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function CurrentVersionCard({
  auditEvent,
  currentTemplateVersion,
  projectId,
  user,
  version,
}: {
  readonly auditEvent: AuditEventView | null;
  readonly currentTemplateVersion: number | null;
  readonly projectId: string;
  readonly user: SessionUser;
  readonly version: HalfPackageQuotationVersionSummary;
}) {
  return (
    <Card className="border-border py-0 shadow-none">
      <CardContent className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="type-section-title m-0">当前有效版本</h2>
          <Badge variant="secondary">{user.displayName}视角</Badge>
        </div>
        <div className="flex items-center gap-2">
          <strong className="type-key-amount">V{version.versionNumber}</strong>
          <Badge variant={statusVariant(version.status)}>{statusLabel(version.status)}</Badge>
        </div>
        <InfoRow
          label="生成时间"
          value={formatDateTime(auditEvent?.occurredAt ?? version.submittedAt)}
        />
        <InfoRow label="操作人" value={auditEvent?.actorDisplayName ?? "—"} />
        <InfoRow label="来源版本" value={sourceVersion(version.versionNumber)} />
        <InfoRow
          label="模板版本"
          value={currentTemplateVersion ? `半包报价模板 V${currentTemplateVersion}` : "—"}
        />
        <Button asChild className="w-full border-border" variant="outline">
          <Link href={snapshotHref(projectId, version.id)}>
            <Eye />
            查看只读快照
          </Link>
        </Button>
        {version.status === "DRAFT" && user.role === "LEAD_DESIGNER" ? (
          <Button asChild className="w-full">
            <Link href={`/projects/${projectId}/quotation`}>继续编辑当前草稿</Link>
          </Button>
        ) : null}
        {version.status === "PENDING_APPROVAL" && hasOwnerPermissions(user.role) ? (
          <Button asChild className="w-full">
            <Link href={`/approvals/${version.id}`}>处理待审批版本</Link>
          </Button>
        ) : null}
        {isApproved(version.status) && hasOwnerPermissions(user.role) ? (
          <>
            <Button className="w-full" disabled variant="destructive">
              <ShieldAlert />
              打回并说明原因
            </Button>
            <p className="type-support m-0 text-muted-foreground">
              打回后应自动生成新的“已退回”版本；当前快照永久保留。
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExportMenu({
  compact = false,
  disabled,
  fullWidth = false,
  onExport,
}: {
  readonly compact?: boolean;
  readonly disabled: boolean;
  readonly fullWidth?: boolean;
  readonly onExport: (format: HalfPackageExportFormat) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className={fullWidth ? "w-full" : undefined}
          disabled={disabled}
          size={compact ? "sm" : "default"}
          variant={compact ? "outline" : "default"}
        >
          {compact ? <Download /> : <FileDown />}
          {compact ? "导出" : "导出客户文件"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-48 gap-1 p-2">
        <Button className="justify-start" onClick={() => onExport("PDF")} variant="ghost">
          <FileDown />
          导出 PDF
        </Button>
        <Button className="justify-start" onClick={() => onExport("XLSX")} variant="ghost">
          <FileDown />
          导出 Excel
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function VersionSelect({
  ariaLabel,
  onChange,
  value,
  versions,
}: {
  readonly ariaLabel: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
  readonly versions: readonly HalfPackageQuotationVersionSummary[];
}) {
  return (
    <select
      aria-label={ariaLabel}
      className="type-table-body h-9 rounded-md border border-border bg-background px-2 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {versions.map((version) => (
        <option key={version.id} value={version.id}>
          V{version.versionNumber}
        </option>
      ))}
    </select>
  );
}

function InfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="type-table-body flex items-center justify-between gap-3 border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}

function auditEventForVersion(
  version: HalfPackageQuotationVersionSummary,
  events: readonly AuditEventView[],
): AuditEventView | null {
  return events.find((event) => event.targetId === version.id) ?? null;
}

function projectStage(status: HalfPackageQuotationVersionSummary["status"]): string {
  return isApproved(status) ? "项目阶段 · 报价完成" : "项目阶段 · 报价中";
}

function statusLabel(status: HalfPackageQuotationVersionSummary["status"]): string {
  if (status === "DRAFT") return "草稿";
  if (status === "RETURNED" || status === "VOID") return "已退回";
  if (status === "APPROVED" || status === "SUPERSEDED") return "已审批";
  return "待审批";
}

function statusVariant(
  status: HalfPackageQuotationVersionSummary["status"],
): "destructive" | "secondary" | "success" | "warning" {
  if (status === "RETURNED" || status === "VOID") return "destructive";
  if (status === "APPROVED" || status === "SUPERSEDED") return "success";
  if (status === "DRAFT") return "secondary";
  return "warning";
}

function isApproved(status: HalfPackageQuotationVersionSummary["status"]): boolean {
  return status === "APPROVED" || status === "SUPERSEDED";
}

function sourceVersion(versionNumber: number): string {
  return versionNumber > 1 ? `V${versionNumber - 1}` : "—";
}

function changeSummary(version: HalfPackageQuotationVersionSummary): string {
  if (version.status === "RETURNED") {
    return version.decisionReason ? `退回：${version.decisionReason}` : "审批退回修改";
  }
  if (version.status === "APPROVED") {
    return version.decisionAction === "SPECIAL_APPROVED"
      ? `特批通过${version.decisionReason ? `：${version.decisionReason}` : ""}`
      : "批准整单；锁定客户输出";
  }
  if (version.status === "SUPERSEDED") return "历史审批快照";
  if (version.status === "DRAFT") {
    return version.versionNumber === 1 ? "新建项目自动生成" : "自动生成草稿版本";
  }
  return "主案提交整单审批";
}

function snapshotHref(projectId: string, quotationId: string): string {
  return `/projects/${projectId}?quotationId=${encodeURIComponent(quotationId)}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatShortTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function auditActionLabel(action: string): string {
  return {
    QUOTATION_APPROVED: "批准整单",
    QUOTATION_DRAFT_CREATED: "新建报价版本",
    QUOTATION_RETURNED: "退回修改",
    QUOTATION_SPECIAL_APPROVED: "特批整单",
    QUOTATION_SUBMITTED: "提交审批",
    QUOTATION_VERSION_COMPARED: "对比版本",
  }[action] ?? action;
}

function auditVersionFlow(event: AuditEventView): string {
  const before = event.beforeValue?.version;
  const after = event.afterValue?.version;
  if (typeof before === "number" && typeof after === "number") {
    return `V${before} → V${after}`;
  }
  if (typeof after === "number") return `V${after}`;
  return event.reason ?? "版本操作已记录";
}

function fieldLabel(field: HalfPackageVersionDifference["field"]): string {
  return {
    QUANTITY: "数量",
    SALE_UNIT_PRICE: "销售单价",
    SELECTED: "选择状态",
    TOTAL: "报价合计",
  }[field];
}

function differenceValue(
  field: HalfPackageVersionDifference["field"],
  value: string | null,
): string {
  if (value === null) return "—";
  if (field === "SELECTED") return value === "true" ? "已选" : "未选";
  if (field === "SALE_UNIT_PRICE" || field === "TOTAL") {
    return `¥ ${formatQuotationMoney(value)}`;
  }
  return Number(value).toFixed(2);
}
