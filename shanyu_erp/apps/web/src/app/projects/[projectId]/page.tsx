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
  fetchProject,
  fetchPublishedCatalog,
  fetchQuotationVersion,
  fetchQuotationVersions,
  fetchSession,
} from "@/lib/api-client";
import { formatQuotationMoney } from "@/lib/quotation-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { ExportMenu } from "./export-menu";
import { SpaceManager } from "./space-manager";

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
  const approved = currentStep === 3;

  return (
    <AppShell active="projects" user={session.user}>
      <main className="grid gap-4 p-6">
        <section className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="type-page-title m-0 tracking-tight">
                {project.name} · {project.customerName}
              </h1>
              <Badge variant={approved ? "success" : "secondary"}>
                {quoteStatusLabel(quotation.status)}
              </Badge>
            </div>
            <p className="type-body m-0 text-muted-foreground">
              {Number(project.buildingArea).toFixed(2)}㎡ · 主案 {project.leadDesigner.displayName} · 木作设计师未指派 · 当前 V{quotation.versionNumber}
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
                版本记录
              </Link>
            </Button>
            {approved ? (
              <ExportMenu quotationId={quotation.id} />
            ) : quotation.status === "DRAFT" ? (
              <Button asChild>
                <Link href={`/projects/${project.id}/quotation/submit`}>
                  <Send />
                  提交审批
                </Link>
              </Button>
            ) : quotation.status === "RETURNED" ? (
              <Button asChild>
                <Link href={`/projects/${project.id}`}>
                  继续修订
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href={`/projects/${project.id}/quotation`}>
                  查看半包报价
                </Link>
              </Button>
            )}
          </div>
        </section>

        <Card className="border-border py-0 shadow-none">
          <CardContent className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {["草稿", "待定价/待补充", "待审批", "已批准"].map(
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
                    销售金额 ¥{displayMoney(quotation.total)}
                  </strong>
                  <Link
                    className="type-action text-primary hover:underline"
                    href={
                      approved
                        ? `/projects/${project.id}/quotation/versions`
                        : `/projects/${project.id}/quotation`
                    }
                  >
                    {approved ? "查看半包报价" : "继续编辑半包"} →
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border py-0 shadow-none">
              <CardContent className="grid gap-3 p-4">
                <h2 className="type-section-title">V2 报价扩展（本轮不展开）</h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    "主材报价",
                    "铂屿木作定制",
                    "第三方代购",
                    "定制项目",
                    "全案汇总",
                  ].map((label) => (
                    <div
                      className="grid gap-1.5 rounded-lg bg-muted p-3 opacity-70"
                      key={label}
                    >
                      <strong className="type-table-head">{label}</strong>
                      <span className="type-support text-muted-foreground">
                        V2 · 待正式模板
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border py-0 shadow-none">
            <CardContent className="grid gap-3 p-4">
              <h2 className="type-section-title">项目与空间</h2>
              <ProjectInfoRow
                label="建筑面积"
                value={`${Number(project.buildingArea).toFixed(2)}㎡`}
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
        ? `${space.displayName} · 包阳台`
        : space.displayName,
    );
  return names.length ? names.join(" / ") : "未配置";
}

function quoteStep(status: string): number {
  if (status === "APPROVED" || status === "SUPERSEDED") return 3;
  if (status === "PENDING_APPROVAL") return 2;
  if (status === "PENDING_PRICING" || status === "PENDING_SUPPLEMENT") return 1;
  return 0;
}

function quoteStatusLabel(status: string): string {
  if (status === "APPROVED" || status === "SUPERSEDED") return "已批准";
  if (status === "PENDING_APPROVAL") return "待审批";
  if (status === "PENDING_PRICING") return "待定价";
  if (status === "PENDING_SUPPLEMENT") return "待补充";
  if (status === "RETURNED") return "已退回";
  return "草稿";
}

function displayMoney(value: string): string {
  return formatQuotationMoney(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
