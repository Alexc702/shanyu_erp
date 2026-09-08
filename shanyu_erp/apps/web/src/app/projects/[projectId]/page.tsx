import type {
  ProjectSpace,
  SpaceType,
} from "@shanyu/contracts";
import { cookies } from "next/headers";
import { History, Send } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchHalfPackageQuotation,
  fetchMainMaterialQuotation,
  fetchProject,
  fetchPublishedCatalog,
  fetchQuotationVersion,
  fetchQuotationVersions,
  fetchSession,
} from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { ExportMenu } from "./export-menu";
import { SpaceManager } from "./space-manager";
import {
  ContinueEditingButton,
  QuotationAdjustment,
  QuotationLiveAmount,
} from "./quotation-actions";

interface ProjectPageProps {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (
    !hasOwnerPermissions(session.user.role) &&
    session.user.role !== "LEAD_DESIGNER"
  ) {
    redirect("/");
  }

  const { projectId } = await params;
  const query = await searchParams;
  const quotationId = firstValue(query.quotationId);
  const project = await fetchProject(cookieHeader, projectId);
  if (!project) notFound();
  const [quotation, versions, catalog] = await Promise.all([
    quotationId
      ? fetchQuotationVersion(cookieHeader, quotationId)
      : fetchHalfPackageQuotation(cookieHeader, projectId),
    fetchQuotationVersions(cookieHeader, projectId),
    fetchPublishedCatalog(cookieHeader),
  ]);
  if (!quotation || quotation.projectId !== projectId) notFound();
  const mainMaterial = quotationId
    ? null
    : await fetchMainMaterialQuotation(cookieHeader, projectId);

  const selectedItemCount = quotation.scopes.reduce(
    (total, scope) =>
      total + scope.lines.filter((line) => line.selected).length,
    0,
  );
  const completedItemCount = quotation.scopes.reduce(
    (total, scope) =>
      total +
      scope.lines.filter((line) => line.selected && line.quantity !== null)
        .length,
    0,
  );
  const completion =
    selectedItemCount === 0
      ? 0
      : Math.round((completedItemCount / selectedItemCount) * 100);
  const standardItemCount = catalog?.items.length ?? 0;
  const currentStep = quoteStep(quotation.status);
  const approved = quotation.status === "APPROVED";
  const ownerAccess = hasOwnerPermissions(session.user.role);
  const adjustmentPending =
    quotation.adjustmentStatus === "PENDING_APPROVAL";
  const returnReason = returnedRevisionReason(quotation, versions);
  const exportVisible =
    (quotation.status === "QUOTED" && !adjustmentPending) ||
    (quotation.status === "APPROVED" &&
      quotation.adjustmentStatus === "CONFIRMED");

  return (
    <AppShell active="projects" user={session.user}>
      <main className="grid gap-4 p-6">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="type-page-title m-0 tracking-tight">
                {project.projectAddress} · {project.customerName}
              </h1>
              <Badge variant={approved ? "success" : "secondary"}>
                {quoteStatusLabel(quotation.status)}
              </Badge>
            </div>
            <p className="type-body m-0 text-muted-foreground">
              外框面积 {Number(project.outerFrameArea).toFixed(2)}㎡ · 主案 {project.leadDesigner.displayName} · 当前 V{quotation.versionNumber}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {quotation.status === "DRAFT" ? (
              <SpaceManager
                projectId={project.id}
                quotation={quotation}
                spaces={project.spaces}
              />
            ) : null}
            <Button asChild className="border-border" variant="outline">
              <Link href={`/projects/${project.id}/quotation/versions`}>
                <History />
                项目版本管理
              </Link>
            </Button>
            {exportVisible ? (
              <ExportMenu
                allowInternal={hasOwnerPermissions(session.user.role)}
                fileNameStem={`${project.projectAddress}_项目报价单_V${quotation.versionNumber}`}
                quotationId={quotation.id}
              />
            ) : null}
            {quotation.status === "DRAFT" ? (
              <Button asChild>
                <Link href={`/projects/${project.id}/quotation/submit`}>
                  <Send />
                  确认生成报价单
                </Link>
              </Button>
            ) : quotation.status === "RETURNED" ||
              (quotation.status === "QUOTED" && !adjustmentPending) ? (
              <ContinueEditingButton
                projectId={project.id}
                quotationId={quotation.id}
                status={quotation.status}
              />
            ) : quotation.status !== "APPROVED" ? (
              <Button asChild>
                <Link href={`/projects/${project.id}/quotation`}>
                  查看报价单
                </Link>
              </Button>
            ) : null}
            {quotation.status === "QUOTED" ? (
              <Button
                disabled={adjustmentPending}
                form="quotation-adjustment-form"
                type="submit"
              >
                {adjustmentPending
                  ? "审批中"
                  : ownerAccess
                    ? "确认折扣"
                    : "提交折扣审批"}
              </Button>
            ) : null}
          </div>
        </section>

        {returnReason ? (
          <Card className="border-destructive/30 bg-destructive/5 py-0 shadow-none">
            <CardContent className="grid gap-1 p-4">
              <strong className="type-entity text-destructive">老板打回原因</strong>
              <p className="type-body m-0">{returnReason}</p>
              <p className="type-support m-0 text-muted-foreground">
                返修草稿保留上一版折扣与抹零；修改工程项并重新确认生成后，可继续调整折扣与抹零再提交审批。
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border-border py-0 shadow-none">
          <CardContent className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {["草稿", "已报价", "已批准"].map(
                (label, index) => (
                  <div className="flex items-center gap-2" key={label}>
                    <span
                      className={`type-status grid size-7 place-items-center rounded-full ${
                        index <= currentStep
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span
                      className={`type-table-head ${
                        index === currentStep
                          ? "text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                ),
              )}
            </div>
          </CardContent>
        </Card>

        <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div className="grid gap-3">
            <Card className="border-border py-0 shadow-none">
              <CardContent className="grid gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="grid gap-1">
                    <h2 className="type-section-title">半包工程</h2>
                    <p className="type-support m-0 text-muted-foreground">
                      {quotation.scopes.length} 个报价分区 · {standardItemCount} 个标准项 · 当前完成 {completion}%
                    </p>
                  </div>
                  <Badge variant={approved ? "success" : "default"}>
                    {quoteStatusLabel(quotation.status)}
                  </Badge>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    aria-label={`半包报价完成度 ${completion}%`}
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${completion}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong className="type-entity">
                    折后金额 ¥
                    <QuotationLiveAmount
                      initialAmount={quotation.adjustedTotal}
                      quotationId={quotation.id}
                    />
                  </strong>
                  {quotation.status === "RETURNED" ||
                  (quotation.status === "QUOTED" && !adjustmentPending) ? (
                    <ContinueEditingButton
                      display="link"
                      projectId={project.id}
                      quotationId={quotation.id}
                      status={quotation.status}
                    />
                  ) : (
                    <Link
                      className="type-action text-primary hover:underline"
                      href={
                        approved
                          ? `/projects/${project.id}/quotation/versions`
                          : `/projects/${project.id}/quotation`
                      }
                    >
                      {adjustmentPending || approved
                        ? "查看半包报价"
                        : "继续编辑半包"} →
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>

            {quotation.status === "QUOTED" ? (
              <QuotationAdjustment
                initialQuotation={quotation}
                mode={
                  adjustmentPending
                    ? "PENDING"
                    : ownerAccess
                      ? "OWNER_CONFIRM"
                      : "DESIGNER_SUBMIT"
                }
                projectId={project.id}
              />
            ) : null}

            <Card className="border-border py-0 shadow-none">
              <CardContent className="grid gap-3 p-4">
                <h2 className="type-section-title">项目报价模块</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Link className="grid gap-1.5 rounded-lg border border-primary/25 bg-primary-soft p-3 transition hover:border-primary" href={`/projects/${project.id}/quotation/main-materials`}>
                    <div className="flex items-center justify-between gap-2"><strong className="type-table-head">主材报价</strong><Badge variant={mainMaterial?.lines.some((line) => line.origin === "AUTO_TILE" && !line.item) ? "warning" : "success"}>{mainMaterial?.status === "DRAFT" ? "选型中" : "已报价"}</Badge></div>
                    <span className="text-base font-semibold text-primary">¥{Number(mainMaterial?.summary.total ?? 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className="type-support text-muted-foreground">{mainMaterial?.lines.filter((line) => line.item).length ?? 0} 项已选 · 查看明细 →</span>
                  </Link>
                  {["铂屿木作定制", "第三方代购", "定制项目", "设计费"].map((label) => <div className="grid gap-1.5 rounded-lg bg-muted p-3 opacity-70" key={label}><strong className="type-table-head">{label}</strong><span className="type-support text-muted-foreground">后续阶段</span></div>)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border py-0 shadow-none">
            <CardContent className="grid gap-3 p-4">
              <h2 className="type-section-title">项目与空间</h2>
              <ProjectInfoRow
                label="外框面积"
                value={`${Number(project.outerFrameArea).toFixed(2)}㎡`}
              />
              <ProjectInfoRow
                label="客餐厅"
                value={spaceNames(project.spaces, ["LIVING_DINING"], true)}
              />
              <ProjectInfoRow
                label="卧室"
                value={spaceNames(project.spaces, ["BEDROOM", "CLOSET"])}
              />
              <ProjectInfoRow
                label="厨卫"
                value={spaceNames(project.spaces, ["KITCHEN", "BATHROOM"])}
              />
              <ProjectInfoRow
                label="独立阳台"
                value={spaceNames(project.spaces, ["BALCONY"])}
              />
              <ProjectInfoRow
                label="报价模板"
                value={`山屿标准半包 V${quotation.templateVersion}`}
              />
              <p className="type-support m-0 text-warning">
                空间名称或参数可在空间调整中修改；影响自动项时以服务端重算结果为准。
              </p>
              <p className="type-support m-0 text-muted-foreground">
                共 {versions?.length ?? 1} 个报价版本
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
    </AppShell>
  );
}

function ProjectInfoRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="type-support flex items-start justify-between gap-4 border-b border-border py-2">
      <span className="shrink-0 font-medium text-muted-foreground">{label}</span>
      <strong className="text-right">{value}</strong>
    </div>
  );
}

function spaceNames(
  spaces: readonly ProjectSpace[],
  types: readonly SpaceType[],
  includeBalcony = false,
): string {
  const names = spaces
    .filter((space) => types.includes(space.type))
    .map((space) =>
      includeBalcony && space.includesBalcony
        ? "客餐厅（包阳台）"
        : space.displayName,
    );
  return names.length ? names.join(" / ") : "未配置";
}

function quoteStep(status: string): number {
  if (status === "APPROVED") return 2;
  if (status === "QUOTED" || status === "RETURNED") return 1;
  return 0;
}

function quoteStatusLabel(status: string): string {
  if (status === "APPROVED") return "已批准";
  if (status === "QUOTED") return "已报价";
  if (status === "RETURNED") return "已退回";
  return "草稿";
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function returnedRevisionReason(
  quotation: {
    readonly id: string;
    readonly status: string;
    readonly versionNumber: number;
  },
  versions: readonly {
    readonly decisionReason: string | null;
    readonly id: string;
    readonly status: string;
    readonly versionNumber: number;
  }[] | null,
): string | null {
  if (!versions) return null;
  if (quotation.status === "RETURNED") {
    return (
      versions.find((version) => version.id === quotation.id)?.decisionReason ??
      null
    );
  }
  if (quotation.status === "DRAFT") {
    return (
      versions.find(
        (version) =>
          version.status === "RETURNED" &&
          version.versionNumber === quotation.versionNumber - 1,
      )?.decisionReason ?? null
    );
  }
  return null;
}
