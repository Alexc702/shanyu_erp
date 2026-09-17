import type {
  ProjectCostAnalysis,
  ProjectCostAnalysisModule,
  ProjectCostAnalysisModuleCode,
  ProjectCostAnalysisScenario,
} from "@shanyu/contracts";
import { ArrowLeft, Info } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchProjectCostAnalysis,
  fetchQuotationVersions,
  fetchSession,
} from "@/lib/api-client";
import { formatMarginRate } from "@/lib/cost-margin-view-model";
import { hasOwnerPermissions } from "@/lib/permissions";
import { formatQuotationMoney } from "@/lib/quotation-client";
import { formatQuotationScopeName } from "@/lib/quotation-view-model";

import { CostAnalysisVersionSelect } from "./cost-analysis-version-select";

interface ProjectCostAnalysisPageProps {
  readonly params: Promise<{ projectId: string }>;
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}

type DetailModule = "half-package" | "main-material";

export default async function ProjectCostAnalysisPage({
  params,
  searchParams,
}: ProjectCostAnalysisPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (!hasOwnerPermissions(session.user.role)) notFound();

  const { projectId } = await params;
  const query = await searchParams;
  const quotationId = firstValue(query.quotationId) ?? undefined;
  const requestedModule = detailModule(firstValue(query.module));
  const analysis = await fetchProjectCostAnalysis(
    cookieHeader,
    projectId,
    quotationId,
  );
  if (!analysis || analysis.projectId !== projectId) notFound();
  const versions =
    (await fetchQuotationVersions(cookieHeader, projectId)) ?? [];

  return (
    <AppShell active="cost-margin" user={session.user}>
      <main className="workflow-page max-w-[1450px] gap-3">
        <AnalysisHeader
          analysis={analysis}
          projectId={projectId}
          versions={versions}
        />
        {requestedModule ? (
          <ModuleDetail analysis={analysis} module={requestedModule} />
        ) : analysis.pending ? (
          <PendingComparison analysis={analysis} />
        ) : (
          <CurrentSummary analysis={analysis} />
        )}
      </main>
    </AppShell>
  );
}

function AnalysisHeader({
  analysis,
  projectId,
  versions,
}: {
  readonly analysis: ProjectCostAnalysis;
  readonly projectId: string;
  readonly versions: readonly {
    readonly adjustmentStatus: "AWAITING_SUBMISSION" | "PENDING_APPROVAL" | "CONFIRMED";
    readonly decisionAction: "APPROVED" | "RETURNED" | null;
    readonly decisionReason: string | null;
    readonly id: string;
    readonly isCurrent: boolean;
    readonly status: "DRAFT" | "QUOTED" | "RETURNED" | "APPROVED";
    readonly submittedAt: string | null;
    readonly total: string;
    readonly versionNumber: number;
  }[];
}) {
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="type-page-title m-0">项目成本分析</h1>
            <Badge variant={analysis.pending ? "warning" : "secondary"}>
              {quoteStatusLabel(analysis)}
            </Badge>
            <Badge variant={analysis.basis === "DRAFT_REALTIME" ? "warning" : "success"}>
              {basisLabel(analysis)}
            </Badge>
          </div>
          <p className="type-support m-0 text-muted-foreground">
            {analysis.projectAddress} · 客户：{analysis.customerName} · 主案设计师：{analysis.leadDesignerName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {versions.length ? (
            <CostAnalysisVersionSelect
              projectId={projectId}
              selectedId={analysis.quotationId}
              versions={versions}
            />
          ) : null}
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}`}>
              <ArrowLeft />
              返回项目管理
            </Link>
          </Button>
        </div>
      </header>
      <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary-soft px-3 py-2 text-primary">
        <Info className="size-4 shrink-0" />
        <p className="type-support m-0 font-medium">
          {analysis.basis === "DRAFT_REALTIME"
            ? `半包与主材均取自报价版本 V${analysis.versionNumber} 当前草稿，按最新保存结果实时计算；历史版本切换后全部只读。`
            : `半包与主材均取自报价版本 V${analysis.versionNumber} 的同一不可变快照；历史版本切换后全部只读。`}
        </p>
      </div>
    </>
  );
}

function CurrentSummary({ analysis }: { readonly analysis: ProjectCostAnalysis }) {
  return (
    <>
      <TaxStrip scenario={analysis.current} />
      <MetricGrid scenario={analysis.current} />
      <ModuleTable analysis={analysis} scenario={analysis.current} />
      <FormulaNote />
    </>
  );
}

function PendingComparison({ analysis }: { readonly analysis: ProjectCostAnalysis }) {
  const pending = analysis.pending;
  if (!pending) return null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-warning">
        <p className="type-support m-0 font-medium">
          待审批优惠仅用于决策对比，不计入当前生效口径；批准前客户导出仍使用当前生效基础报价。
        </p>
        <Badge className="bg-background text-warning" variant="warning">
          方案只读
        </Badge>
      </div>
      <section className="grid gap-3 xl:grid-cols-2" aria-label="当前与待审批方案">
        <ScenarioPanel
          badge="生效中"
          scenario={analysis.current}
          title="当前生效基础报价"
          tone="success"
        />
        <ScenarioPanel
          badge="未生效"
          scenario={pending}
          title="待审批优惠方案"
          tone="warning"
        />
      </section>
      <ImpactStrip current={analysis.current} pending={pending} />
      <ComparisonTable current={analysis.current} pending={pending} />
      <FormulaNote />
    </>
  );
}

function ScenarioPanel({
  badge,
  scenario,
  title,
  tone,
}: {
  readonly badge: string;
  readonly scenario: ProjectCostAnalysisScenario;
  readonly title: string;
  readonly tone: "success" | "warning";
}) {
  const border = tone === "success" ? "border-success/40 bg-success-soft" : "border-warning/40 bg-warning-soft";
  return (
    <Card className={`${border} py-0 shadow-none`}>
      <CardContent className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="type-entity">{title}</h2>
          <Badge variant={tone}>{badge}</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-5">
          <CompactMetric label="客户应付" value={money(scenario.customerPayableTotal)} />
          <CompactMetric label="毛利收入" value={money(scenario.marginBasisIncome)} />
          <CompactMetric label="预计成本" value={money(scenario.expectedCost)} />
          <CompactMetric label="预计毛利" value={money(scenario.grossProfit)} />
          <CompactMetric label="毛利率" value={formatMarginRate(scenario.grossMarginRate)} />
        </div>
      </CardContent>
    </Card>
  );
}

function ImpactStrip({
  current,
  pending,
}: {
  readonly current: ProjectCostAnalysisScenario;
  readonly pending: ProjectCostAnalysisScenario;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-md bg-muted px-4 py-3">
      <strong className="type-table-head">待审批方案影响</strong>
      <span className="type-support font-semibold">
        毛利口径收入 {moneyDelta(current.marginBasisIncome, pending.marginBasisIncome)}
      </span>
      <span className="type-support font-semibold">
        预计毛利 {moneyDelta(current.grossProfit, pending.grossProfit)}
      </span>
      <span className="type-support font-semibold">
        综合毛利率 {rateDelta(current.grossMarginRate, pending.grossMarginRate)}
      </span>
      <span className="ml-auto type-support text-muted-foreground">预计成本不变</span>
    </div>
  );
}

function ComparisonTable({
  current,
  pending,
}: {
  readonly current: ProjectCostAnalysisScenario;
  readonly pending: ProjectCostAnalysisScenario;
}) {
  return (
    <Card className="overflow-hidden border-border py-0 shadow-none">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="type-entity">模块优惠影响</h2>
        <span className="type-support text-muted-foreground">整单折扣按各模块报价占比分摊</span>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[1050px] table-fixed">
          <TableHeader><TableRow className="bg-muted hover:bg-muted"><TableHead>报价模块</TableHead><TableHead>当前生效</TableHead><TableHead>待审批方案</TableHead><TableHead>报价变化</TableHead><TableHead>预计成本</TableHead><TableHead>方案毛利</TableHead><TableHead>毛利率变化</TableHead></TableRow></TableHeader>
          <TableBody>
            {current.modules.map((module, index) => {
              const pendingModule = pending.modules[index];
              if (!pendingModule) return null;
              return (
                <TableRow key={module.code}>
                  <TableCell className="font-semibold">{moduleName(module.code)}</TableCell>
                  <ModuleMoney value={module.customerPrice} />
                  <ModuleMoney emphasis value={pendingModule.customerPrice} />
                  <TableCell className="font-semibold">{nullableMoneyDelta(module.customerPrice, pendingModule.customerPrice)}</TableCell>
                  <ModuleMoney value={pendingModule.expectedCost} />
                  <ModuleMoney emphasis value={pendingModule.grossProfit} />
                  <TableCell className="font-semibold">{rateTransition(module.grossMarginRate, pendingModule.grossMarginRate)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function ModuleDetail({
  analysis,
  module,
}: {
  readonly analysis: ProjectCostAnalysis;
  readonly module: DetailModule;
}) {
  const code = module === "half-package" ? "HALF_PACKAGE" : "MAIN_MATERIAL";
  const selected = analysis.current.modules.find((candidate) => candidate.code === code);
  if (!selected || selected.customerPrice === null) return <CurrentSummary analysis={analysis} />;
  const summaryHref = costAnalysisHref(analysis);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3">
        <p className="type-support m-0 text-muted-foreground">
          已在同一项目、同一报价版本下展开{moduleName(code)}成本明细。
        </p>
        <Button asChild size="sm" variant="outline"><Link href={summaryHref}>返回项目汇总</Link></Button>
      </div>
      <div className="grid gap-3 xl:grid-cols-[230px_minmax(0,1fr)]">
        <ModuleNavigation analysis={analysis} active={code} />
        <div className="grid min-w-0 gap-3">
          <Card className="border-border py-0 shadow-none">
            <CardContent className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="type-section-title">{moduleName(code)}成本明细</h2>
                  <p className="type-support m-0 text-muted-foreground">价格与成本均取自报价版本 V{analysis.versionNumber} 快照</p>
                </div>
                <Badge variant="outline">只读</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <CompactMetric label="对客报价" value={money(selected.customerPrice)} />
                <CompactMetric label="预计成本" value={money(selected.expectedCost)} />
                <CompactMetric label="预计毛利" value={money(selected.grossProfit)} />
                <CompactMetric label="毛利率" value={formatMarginRate(selected.grossMarginRate)} />
              </div>
            </CardContent>
          </Card>
          {module === "half-package" ? (
            <HalfPackageDetail analysis={analysis} />
          ) : (
            <MainMaterialDetail analysis={analysis} />
          )}
        </div>
      </div>
    </>
  );
}

function ModuleNavigation({
  active,
  analysis,
}: {
  readonly active: ProjectCostAnalysisModuleCode;
  readonly analysis: ProjectCostAnalysis;
}) {
  return (
    <Card className="h-fit border-border py-0 shadow-none">
      <CardContent className="grid gap-1 p-3">
        <h2 className="type-section-title px-2 py-2">报价模块</h2>
        {analysis.current.modules.map((module) => {
          const detail = module.code === "HALF_PACKAGE" ? "half-package" : module.code === "MAIN_MATERIAL" ? "main-material" : null;
          const content = <><span className="font-medium">{moduleName(module.code)}</span><span className="type-support">{moduleStatusLabel(module)}</span></>;
          return detail && module.customerPrice !== null ? (
            <Link className={`grid rounded-md px-3 py-2 ${active === module.code ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`} href={`${costAnalysisHref(analysis)}&module=${detail}`} key={module.code}>{content}</Link>
          ) : (
            <div className="grid rounded-md px-3 py-2 text-muted-foreground" key={module.code}>{content}</div>
          );
        })}
        <div className="mt-2 rounded-md bg-muted px-3 py-2 type-support text-muted-foreground">
          所有模块均来自 V{analysis.versionNumber} 同一报价版本。
        </div>
      </CardContent>
    </Card>
  );
}

function HalfPackageDetail({ analysis }: { readonly analysis: ProjectCostAnalysis }) {
  return (
    <Card className="overflow-hidden border-border py-0 shadow-none">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h3 className="type-entity">分区汇总</h3>
        <span className="type-support text-muted-foreground">仅显示当前报价版本有效行</span>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[760px]">
          <TableHeader><TableRow className="bg-muted hover:bg-muted"><TableHead>分区 / 空间</TableHead><TableHead>销售金额</TableHead><TableHead>预计成本</TableHead><TableHead>预计毛利</TableHead><TableHead>毛利率</TableHead></TableRow></TableHeader>
          <TableBody>{analysis.halfPackage.scopes.map((scope) => <TableRow key={scope.id}><TableCell className="font-semibold">{formatQuotationScopeName(scope.name)}</TableCell><TableCell>{money(scope.salesAmount)}</TableCell><TableCell>{money(scope.expectedCost)}</TableCell><TableCell className="font-semibold">{money(scope.grossProfit)}</TableCell><TableCell className="font-semibold">{formatMarginRate(scope.grossMarginRate)}</TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
    </Card>
  );
}

function MainMaterialDetail({ analysis }: { readonly analysis: ProjectCostAnalysis }) {
  return (
    <Card className="overflow-hidden border-border py-0 shadow-none">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h3 className="type-entity">分类汇总</h3>
        <span className="type-support text-muted-foreground">主材库 V{analysis.mainMaterial.catalogVersion ?? "—"}</span>
      </div>
      {analysis.mainMaterial.categories.length ? (
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader><TableRow className="bg-muted hover:bg-muted"><TableHead>主材分类</TableHead><TableHead>对客报价</TableHead><TableHead>预计成本</TableHead><TableHead>预计毛利</TableHead><TableHead>毛利率</TableHead></TableRow></TableHeader>
            <TableBody>{analysis.mainMaterial.categories.map((category) => <TableRow key={category.categoryCode}><TableCell className="font-semibold">{categoryName(category.categoryCode)}</TableCell><TableCell>{money(category.customerPrice)}</TableCell><TableCell>{money(category.expectedCost)}</TableCell><TableCell className="font-semibold">{money(category.grossProfit)}</TableCell><TableCell className="font-semibold">{formatMarginRate(category.grossMarginRate)}</TableCell></TableRow>)}</TableBody>
          </Table>
        </div>
      ) : (
        <div className="border-t border-border px-4 py-10 text-center type-body text-muted-foreground">当前版本暂无已计价主材</div>
      )}
    </Card>
  );
}

function TaxStrip({ scenario }: { readonly scenario: ProjectCostAnalysisScenario }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-4 py-3">
      <span className="type-support text-muted-foreground">半包税金（单列）</span>
      <strong className="type-entity">{money(scenario.halfPackageTaxAmount)}</strong>
      <Badge variant="secondary">不计毛利收入</Badge>
    </div>
  );
}

function MetricGrid({ scenario }: { readonly scenario: ProjectCostAnalysisScenario }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="项目成本指标">
      <MetricCard label="客户应付总价" note="含半包 6% 税金" value={money(scenario.customerPayableTotal)} />
      <MetricCard label="毛利口径收入" note="不含半包税金与第三方代购" value={money(scenario.marginBasisIncome)} />
      <MetricCard label="预计成本" note="仅计入综合毛利的模块成本" value={money(scenario.expectedCost)} />
      <MetricCard label="预计毛利" note="毛利口径收入 − 预计成本" value={money(scenario.grossProfit)} />
      <MetricCard label="综合毛利率" note="预计毛利 ÷ 毛利口径收入" value={formatMarginRate(scenario.grossMarginRate)} />
    </section>
  );
}

function MetricCard({ label, note, value }: { readonly label: string; readonly note: string; readonly value: string }) {
  return <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-2 p-4"><span className="type-table-body text-muted-foreground">{label}</span><strong className="text-xl tracking-tight">{value}</strong><small className="type-support text-muted-foreground">{note}</small></CardContent></Card>;
}

function CompactMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="grid gap-1"><span className="type-support text-muted-foreground">{label}</span><strong className="text-base">{value}</strong></div>;
}

function ModuleTable({ analysis, scenario }: { readonly analysis: ProjectCostAnalysis; readonly scenario: ProjectCostAnalysisScenario }) {
  return (
    <Card className="overflow-hidden border-border py-0 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div><h2 className="type-entity">报价模块</h2><p className="type-support m-0 text-muted-foreground">点击操作仅切换同一项目、同一报价版本下的成本明细</p></div><span className="type-support text-muted-foreground">4 个模块</span></div>
      <div className="overflow-x-auto"><Table className="min-w-[1000px] table-fixed"><TableHeader><TableRow className="bg-muted hover:bg-muted"><TableHead>报价模块</TableHead><TableHead>完成状态</TableHead><TableHead>对客报价</TableHead><TableHead>预计成本</TableHead><TableHead>预计毛利</TableHead><TableHead>毛利率</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{scenario.modules.map((module) => <TableRow key={module.code}><TableCell><strong className="type-table-body block">{moduleName(module.code)}</strong><span className="type-support text-muted-foreground">{module.note}</span></TableCell><TableCell><Badge variant={module.status === "COMPLETED" ? "success" : module.status === "DRAFT" ? "warning" : "secondary"}>{moduleStatusLabel(module)}</Badge></TableCell><ModuleMoney value={module.customerPrice} /><ModuleMoney value={module.expectedCost} /><ModuleMoney emphasis value={module.grossProfit} /><TableCell className="font-semibold">{module.grossMarginRate === null ? "—" : formatMarginRate(module.grossMarginRate)}</TableCell><TableCell>{module.code === "HALF_PACKAGE" || module.code === "MAIN_MATERIAL" ? <Button asChild className="h-8 px-2.5" variant="ghost"><Link href={`${costAnalysisHref(analysis)}&module=${module.code === "HALF_PACKAGE" ? "half-package" : "main-material"}`}>{module.code === "HALF_PACKAGE" ? "查看半包成本" : "查看主材成本"}</Link></Button> : <span className="text-muted-foreground">—</span>}</TableCell></TableRow>)}</TableBody></Table></div>
    </Card>
  );
}

function ModuleMoney({ emphasis = false, value }: { readonly emphasis?: boolean; readonly value: string | null }) {
  return <TableCell className={emphasis ? "font-semibold" : undefined}>{value === null ? "—" : money(value)}</TableCell>;
}

function FormulaNote() {
  return <p className="type-support m-0 rounded-md bg-primary-soft px-3 py-3 font-medium text-primary">毛利口径收入 = 半包税前收入 + 主材收入 + 其他纳入毛利模块收入；半包税金与第三方代购返点不参与综合毛利率。</p>;
}

function costAnalysisHref(analysis: ProjectCostAnalysis): string {
  return `/projects/${analysis.projectId}/cost-analysis?quotationId=${encodeURIComponent(analysis.quotationId)}`;
}

function moduleName(code: ProjectCostAnalysisModuleCode): string {
  return { HALF_PACKAGE: "半包报价", MAIN_MATERIAL: "主材报价", THIRD_PARTY: "第三方代购", WOODWORK: "铂屿木作定制" }[code];
}

function moduleStatusLabel(module: ProjectCostAnalysisModule): string {
  return { COMPLETED: "已完成", DRAFT: "草稿", INCOMPLETE: "未完成", INDEPENDENT: "独立核算", NOT_ENABLED: "未启用" }[module.status];
}

function quoteStatusLabel(analysis: ProjectCostAnalysis): string {
  if (analysis.adjustmentStatus === "PENDING_APPROVAL") return "待审批";
  return { APPROVED: "已批准", DRAFT: "草稿", QUOTED: "已报价", RETURNED: "已退回" }[analysis.status];
}

function basisLabel(analysis: ProjectCostAnalysis): string {
  return { APPROVED_EFFECTIVE: "批准生效", CURRENT_EFFECTIVE: "当前生效", DRAFT_REALTIME: "草稿实时", PENDING_COMPARISON: "双方案对比", RETURNED_READONLY: "退回只读" }[analysis.basis];
}

function categoryName(code: string): string {
  return ({ BATHROOM: "卫浴", CEILING: "集成吊顶", CUSTOM: "定制类", FLOOR: "木地板", GLASS_DOOR: "房门／玻璃门", SEAM: "美缝", SERVICE_FEE: "服务费（10%）", SHOWER: "淋浴房", STONE: "石材／岩板", SWITCH: "开关面板", TILE: "瓷砖" } as Record<string, string>)[code] ?? code;
}

function money(value: string | null): string {
  return value === null ? "—" : `¥${formatQuotationMoney(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function moneyDelta(current: string, next: string): string {
  const difference = Number(next) - Number(current);
  return `${difference > 0 ? "+" : difference < 0 ? "−" : ""}${money(Math.abs(difference).toFixed(4))}`;
}

function nullableMoneyDelta(current: string | null, next: string | null): string {
  return current === null || next === null ? "—" : moneyDelta(current, next);
}

function rateDelta(current: string | null, next: string | null): string {
  if (current === null || next === null) return "—";
  const points = (Number(next) - Number(current)) * 100;
  return `${points > 0 ? "+" : points < 0 ? "−" : ""}${Math.abs(points).toFixed(2)} 个百分点`;
}

function rateTransition(current: string | null, next: string | null): string {
  return `${formatMarginRate(current)} → ${formatMarginRate(next)}`;
}

function detailModule(value: string | null): DetailModule | null {
  return value === "half-package" || value === "main-material" ? value : null;
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
