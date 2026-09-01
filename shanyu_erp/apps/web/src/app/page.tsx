import type {
  HalfPackageQuotationVersionSummary,
  ProjectSummary,
} from "@shanyu/contracts";
import { cookies } from "next/headers";
import { ArrowUpRight, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  fetchHalfPackageCostMargin,
  fetchPendingApprovals,
  fetchProjects,
  fetchQuotationVersions,
  fetchSession,
} from "@/lib/api-client";
import { getWorkbench } from "@/lib/workbench";
import { hasOwnerPermissions } from "@/lib/permissions";

interface HomeProps {
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}

type LeadProjectStatus = "approved" | "draft" | "returned";

interface LeadProjectItem {
  readonly activityAt: string | null;
  readonly project: ProjectSummary;
  readonly quotationId: string | null;
  readonly status: LeadProjectStatus;
  readonly versionNumber: number;
}

export default async function Home({ searchParams }: HomeProps) {
  const cookieHeader = (await cookies()).toString();
  const params = await searchParams;
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  const workbench = getWorkbench(session.user.role);
  const canAccessProjects =
    hasOwnerPermissions(session.user.role) || session.user.role === "LEAD_DESIGNER";
  const projects = canAccessProjects ? await fetchProjects(cookieHeader) : null;
  const isOwner = hasOwnerPermissions(session.user.role);
  const isLead = session.user.role === "LEAD_DESIGNER";
  const projectList = projects ?? [];
  const versionsByProject = canAccessProjects
    ? await Promise.all(
        projectList.map((project) =>
          fetchQuotationVersions(cookieHeader, project.id),
        ),
      )
    : [];
  const versions = versionsByProject.flatMap((items) => items ?? []);
  const leadProjects = isLead
    ? projectList.flatMap((project, index) =>
        toLeadProjectItems(project, versionsByProject[index] ?? []),
      )
    : [];
  const pendingApprovals = isOwner ? await fetchPendingApprovals(cookieHeader) : null;
  const margins = isOwner
    ? (await Promise.all(projectList.map((project) => fetchHalfPackageCostMargin(cookieHeader, project.id)))).filter((item) => item !== null)
    : [];
  const totalSales = margins.reduce((sum, item) => sum + Number(item.salesAmount), 0);
  const totalCost = margins.reduce((sum, item) => sum + Number(item.expectedCost), 0);
  const aggregateMargin = totalSales > 0
    ? `${(((totalSales - totalCost) / totalSales) * 100).toFixed(2)}%`
    : "—";
  const metrics = isOwner
    ? [
        ["进行中项目", String(projects?.length ?? 0), "当前可访问项目"],
        ["待定价", String(versions.filter((item) => item.status === "PENDING_PRICING").length), "报价版本"],
        ["待审批", String(pendingApprovals?.length ?? 0), "进入审批中心处理"],
        ["半包预计毛利率", aggregateMargin, "当前报价汇总"],
      ]
    : isLead ? [
        ["我的项目", String(projects?.length ?? 0), "本人负责"],
        ["草稿", String(versions.filter((item) => item.status === "DRAFT").length), "半包报价持续保存"],
        ["已退回", String(versions.filter((item) => item.status === "RETURNED").length), "根据审批意见修订"],
        ["已批准", String(versions.filter((item) => item.status === "APPROVED").length), "已锁定版本"],
      ] : [
        ["当前角色", "预留", "V1 不开放业务操作"],
        ["项目报价", "—", "不可访问"],
        ["主材库", "—", "不可访问"],
        ["审批与成本", "—", "不可访问"],
      ];

  if (isLead) {
    return (
      <AppShell active="dashboard" user={session.user}>
        <LeadWorkbench
          displayName={session.user.displayName}
          params={params}
          projectCount={projectList.length}
          projects={leadProjects}
        />
      </AppShell>
    );
  }

  return (
    <AppShell active="dashboard" user={session.user}>
      <main className="page-content">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">工作台</p>
            <h1>上午好，{session.user.displayName}</h1>
            <p>
              {isOwner
                ? "查看全公司报价、待定价、审批与预计毛利"
                : workbench.description}
            </p>
          </div>
          {canAccessProjects ? (
            <Button asChild>
              <Link href="/projects/new"><Plus />新建项目</Link>
            </Button>
          ) : null}
        </section>

        <section className="metric-grid" aria-label="业务概览">
          {metrics.map(([label, value, hint]) => (
            <article className="metric-card" key={label}>
              <p>{label}</p>
              <strong>{value}</strong>
              <small>{hint}</small>
            </article>
          ))}
        </section>

        <section className={isOwner ? "dashboard-grid" : "dashboard-grid single"}>
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{isOwner ? "今日待办" : "最近编辑"}</p>
                <h2>{projects?.length ? "可继续处理的项目" : "暂无待处理项目"}</h2>
              </div>
              <span className="status-dot">系统正常</span>
            </div>
            {projects?.length ? (
              <div className="recent-project-list">
                {projects.slice(0, 3).map((project) => (
                  <Link href={`/projects/${project.id}`} key={project.id}>
                    <strong>{project.name} · {project.customerName}</strong>
                    <span>{Number(project.buildingArea).toFixed(2)} M² · 打开项目</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted-copy">创建项目后，最近编辑和阶段状态会显示在这里。</p>
            )}
          </article>

          {isOwner ? (
            <article className="panel action-panel">
              <p className="eyebrow">异常与提醒</p>
              <h2>{workbench.roleLabel}</h2>
              <ul className="check-list">
                <li>主材库已发布版本可供新报价引用</li>
                <li>已保存草稿使用固定模板快照</li>
              </ul>
            </article>
          ) : null}
        </section>
      </main>
    </AppShell>
  );
}

function LeadWorkbench({
  displayName,
  params,
  projectCount,
  projects,
}: {
  readonly displayName: string;
  readonly params: Record<string, string | string[] | undefined>;
  readonly projectCount: number;
  readonly projects: readonly LeadProjectItem[];
}) {
  const grouped = {
    approved: projects.filter((project) => project.status === "approved"),
    draft: projects.filter((project) => project.status === "draft"),
    returned: projects.filter((project) => project.status === "returned"),
  };

  return (
    <main className="grid gap-4 p-6">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid gap-1">
          <p className="type-support m-0 text-muted-foreground">工作台</p>
          <h1 className="type-page-title m-0 tracking-tight">
            上午好，{displayName}
          </h1>
          <p className="type-body m-0 text-muted-foreground">
            查看并继续处理本人负责或获授权的项目
          </p>
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <Plus />
            新建项目
          </Link>
        </Button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="业务概览">
        {[
          ["我的项目", projectCount, "本人负责"],
          ["草稿", grouped.draft.length, "半包报价持续保存"],
          ["已退回", grouped.returned.length, "根据审批意见修订"],
          ["已批准", grouped.approved.length, "已锁定版本"],
        ].map(([label, value, hint]) => (
          <Card className="grid gap-3 border-border p-4 shadow-none" key={label}>
            <span className="type-table-body text-muted-foreground">{label}</span>
            <strong className="text-2xl leading-none">{value}</strong>
            <small className="type-table-body text-muted-foreground">{hint}</small>
          </Card>
        ))}
      </section>

      <section className="grid min-h-0 gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="type-section-title m-0">我的项目</h2>
            <p className="type-support m-0 text-muted-foreground">
              按项目创建时间由近及远；每个状态显示最近 5 个，点击项目名称或“打开项目”进入项目
            </p>
          </div>
          <span className="type-support text-muted-foreground">
            共 {projectCount} 个项目
          </span>
        </div>

        <div className="grid items-stretch gap-3 xl:grid-cols-3">
          <StatusProjectCard
            badgeVariant="secondary"
            description="可继续编辑"
            items={grouped.draft}
            pageKey="draftPage"
            params={params}
            title="草稿"
          />
          <StatusProjectCard
            badgeVariant="destructive"
            description="修改后重新提交"
            items={grouped.returned}
            pageKey="returnedPage"
            params={params}
            title="已退回"
          />
          <StatusProjectCard
            badgeVariant="success"
            description="可打开项目并导出"
            items={grouped.approved}
            pageKey="approvedPage"
            params={params}
            title="已批准"
          />
        </div>
      </section>
    </main>
  );
}

function StatusProjectCard({
  badgeVariant,
  description,
  items,
  pageKey,
  params,
  title,
}: {
  readonly badgeVariant: "destructive" | "secondary" | "success";
  readonly description: string;
  readonly items: readonly LeadProjectItem[];
  readonly pageKey: "approvedPage" | "draftPage" | "returnedPage";
  readonly params: Record<string, string | string[] | undefined>;
  readonly title: string;
}) {
  const totalPages = Math.max(1, Math.ceil(items.length / 5));
  const page = Math.min(totalPages, pageNumber(params[pageKey]));
  const visibleItems = items.slice((page - 1) * 5, page * 5);

  return (
    <Card className="flex min-h-[470px] flex-col overflow-hidden border-border py-0 shadow-none">
      <header className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="grid gap-0.5">
          <h3 className="type-section-title">{title}</h3>
          <p className="type-support m-0 text-muted-foreground">{description}</p>
        </div>
        <Badge className="px-2.5 py-1" variant={badgeVariant}>
          {items.length} 个
        </Badge>
      </header>
      <div className="h-px bg-border" />

      <div className="flex-1">
        {visibleItems.length ? (
          visibleItems.map((item) => (
            <article
              className="flex h-[70px] items-center justify-between gap-3 border-b border-border px-3.5 py-2.5"
              key={item.project.id}
            >
              <div className="min-w-0 space-y-1">
                <Link
                  className="type-entity block truncate text-primary hover:underline"
                  href={projectHref(item)}
                >
                  {item.project.name}
                </Link>
                <p className="type-support m-0 truncate text-muted-foreground">
                  {item.project.customerName} · V{item.versionNumber}
                </p>
              </div>
              <div className="grid shrink-0 justify-items-end gap-1">
                <time className="type-support text-muted-foreground">
                  {formatActivityTime(item.activityAt)}
                </time>
                <Link
                  className="type-action inline-flex items-center gap-0.5 text-primary hover:underline"
                  href={projectHref(item)}
                >
                  打开项目
                  <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </article>
          ))
        ) : (
          <div className="type-support grid h-full min-h-40 place-items-center px-4 text-muted-foreground">
            暂无{title}项目
          </div>
        )}
      </div>

      <footer className="flex h-12 items-center justify-between border-t border-border px-3.5">
        <span className="type-support text-muted-foreground">
          每页 5 条 · {page} / {totalPages}
        </span>
        <div className="flex gap-1.5">
          <PaginationButton
            direction="previous"
            disabled={page <= 1}
            href={pageHref(params, pageKey, page - 1)}
          />
          <PaginationButton
            direction="next"
            disabled={page >= totalPages}
            href={pageHref(params, pageKey, page + 1)}
          />
        </div>
      </footer>
    </Card>
  );
}

function PaginationButton({
  direction,
  disabled,
  href,
}: {
  readonly direction: "next" | "previous";
  readonly disabled: boolean;
  readonly href: string;
}) {
  const label = direction === "previous" ? "上一页" : "下一页";
  const icon =
    direction === "previous" ? (
      <ChevronLeft aria-hidden="true" />
    ) : (
      <ChevronRight aria-hidden="true" />
    );
  return disabled ? (
    <Button aria-label={label} disabled size="icon" variant="secondary">
      {icon}
    </Button>
  ) : (
    <Button aria-label={label} asChild size="icon" variant="secondary">
      <Link href={href}>{icon}</Link>
    </Button>
  );
}

function toLeadProjectItems(
  project: ProjectSummary,
  versions: readonly HalfPackageQuotationVersionSummary[],
): readonly LeadProjectItem[] {
  if (versions.length === 0) {
    return [
      {
        activityAt: null,
        project,
        quotationId: null,
        status: "draft",
        versionNumber: 1,
      },
    ];
  }
  const statusVersions: readonly [
    LeadProjectStatus,
    HalfPackageQuotationVersionSummary | undefined,
  ][] = [
    ["draft", versions.find((version) => version.status === "DRAFT")],
    ["returned", versions.find((version) => version.status === "RETURNED")],
    ["approved", versions.find((version) => version.status === "APPROVED")],
  ];
  return statusVersions.flatMap(([status, version]) =>
    version
      ? [
          {
            activityAt: version.submittedAt,
            project,
            quotationId: version.id,
            status,
            versionNumber: version.versionNumber,
          },
        ]
      : [],
  );
}

function projectHref(item: LeadProjectItem): string {
  const base = `/projects/${item.project.id}`;
  return item.quotationId
    ? `${base}?quotationId=${encodeURIComponent(item.quotationId)}`
    : base;
}

function pageNumber(value: string | string[] | undefined): number {
  const normalized = Array.isArray(value) ? value[0] : value;
  const number = Number.parseInt(normalized ?? "1", 10);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function pageHref(
  params: Record<string, string | string[] | undefined>,
  key: "approvedPage" | "draftPage" | "returnedPage",
  page: number,
): string {
  const next = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized) next.set(name, normalized);
  }
  if (page <= 1) next.delete(key);
  else next.set(key, String(page));
  const query = next.toString();
  return query ? `/?${query}` : "/";
}

function formatActivityTime(value: string | null): string {
  if (!value) return "尚未提交";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
