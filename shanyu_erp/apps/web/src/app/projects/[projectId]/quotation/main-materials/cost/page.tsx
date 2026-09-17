import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchMainMaterialQuotation, fetchProject, fetchSession } from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

export default async function MainMaterialCostPage({ params }: { readonly params: Promise<{ projectId: string }> }) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  if (!hasOwnerPermissions(session.user.role)) notFound();

  const { projectId } = await params;
  const [quotation, project] = await Promise.all([
    fetchMainMaterialQuotation(cookieHeader, projectId),
    fetchProject(cookieHeader, projectId),
  ]);
  if (!quotation || !project || quotation.summary.expectedCost === undefined) notFound();

  const lines = quotation.lines.filter((line) => line.item && line.amount && line.costAmount);
  const categorySummaries = [...new Set(lines.map((line) => line.categoryCode))].map((code) => {
    const categoryLines = lines.filter((line) => line.categoryCode === code);
    const sales = categoryLines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
    const cost = categoryLines.reduce((sum, line) => sum + Number(line.costAmount ?? 0), 0);
    return { code, cost, margin: sales ? (sales - cost) / sales : null, sales };
  });

  return (
    <AppShell active="quotation" user={session.user}>
      <main className="workflow-page max-w-[1450px]">
        <header className="workflow-header">
          <div className="grid gap-1">
            <Link
              className="type-action flex w-fit items-center gap-1 text-muted-foreground hover:text-primary"
              href={`/projects/${projectId}/quotation/main-materials`}
            >
              <ArrowLeft className="size-3.5" />
              返回主材选型
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="type-page-title">主材成本分析</h1>
              <Badge variant="outline">仅老板 / 管理员可见</Badge>
            </div>
            <p className="type-body m-0 text-muted-foreground">
              {project.projectAddress} · 主材库 V{quotation.catalogVersion.versionNumber}
            </p>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="主材销售额" value={money(quotation.summary.total)} />
          <Metric label="锁价成本" value={money(quotation.summary.expectedCost)} />
          <Metric label="预计毛利" value={money(quotation.summary.grossProfit ?? "0")} />
          <Metric label="综合毛利率" value={percent(quotation.summary.grossMarginRate)} />
        </div>

        <div className="grid gap-3 xl:grid-cols-[230px_minmax(0,1fr)]">
          <Card className="h-fit border-border py-0 shadow-none">
            <CardContent className="grid gap-1 p-3">
              <h2 className="type-section-title px-2 py-2">主材分类</h2>
              <a
                className="flex min-h-11 items-center justify-between rounded-md bg-primary px-3 text-sm text-primary-foreground"
                href="#cost-detail"
              >
                <span>全部主材</span>
                <strong>{money(quotation.summary.total)}</strong>
              </a>
              {categorySummaries.map((summary) => (
                <a
                  className="flex min-h-11 items-center justify-between rounded-md px-3 text-sm hover:bg-muted"
                  href={`#cost-${summary.code}`}
                  key={summary.code}
                >
                  <span>
                    <span className="block font-medium">{categoryName(summary.code)}</span>
                    <span className="type-support text-muted-foreground">{money(String(summary.sales))}</span>
                  </span>
                  <strong className={summary.margin !== null && summary.margin < 0.3 ? "text-warning" : "text-success"}>
                    {summary.margin === null ? "—" : `${(summary.margin * 100).toFixed(1)}%`}
                  </strong>
                </a>
              ))}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border py-0 shadow-none" id="cost-detail">
            <div className="border-b border-border px-4 py-3">
              <h2 className="type-section-title">主材成本明细</h2>
              <p className="type-support m-0 text-muted-foreground">销售价与成本价均取自当前报价引用的版本快照</p>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[1000px]">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>分类</TableHead>
                    <TableHead>品牌 / 型号</TableHead>
                    <TableHead>规格</TableHead>
                    <TableHead>数量</TableHead>
                    <TableHead>销售单价</TableHead>
                    <TableHead>销售金额</TableHead>
                    <TableHead>成本单价</TableHead>
                    <TableHead>成本金额</TableHead>
                    <TableHead>毛利</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => {
                    const isFirstCategoryRow = lines.findIndex(
                      (candidate) => candidate.categoryCode === line.categoryCode,
                    ) === index;
                    return (
                      <TableRow
                        id={isFirstCategoryRow ? `cost-${line.categoryCode}` : undefined}
                        key={line.id}
                      >
                        <TableCell>{categoryName(line.categoryCode)}</TableCell>
                        <TableCell>
                          <strong>{line.item?.brand || line.item?.itemName}</strong>
                          <span className="block text-xs text-muted-foreground">{line.item?.model}</span>
                        </TableCell>
                        <TableCell>{line.item?.spec || "—"}</TableCell>
                        <TableCell>{Number(line.quantity).toFixed(2)}</TableCell>
                        <TableCell>{money(line.item?.saleUnitPrice ?? "0")}</TableCell>
                        <TableCell>{money(line.amount ?? "0")}</TableCell>
                        <TableCell>{money(line.item?.costUnitPrice ?? "0")}</TableCell>
                        <TableCell>{money(line.costAmount ?? "0")}</TableCell>
                        <TableCell className="font-semibold">
                          {money(String(Number(line.amount ?? 0) - Number(line.costAmount ?? 0)))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Card className="border-border py-0 shadow-none">
      <CardContent className="grid gap-1 p-4">
        <span className="type-support text-muted-foreground">{label}</span>
        <strong className="text-2xl">{value}</strong>
      </CardContent>
    </Card>
  );
}

function money(value: string) {
  return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value: string | null | undefined) {
  return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(2)}%`;
}

function categoryName(code: string) {
  return ({
    TILE: "瓷砖",
    SEAM: "美缝",
    FLOOR: "木地板",
    GLASS_DOOR: "房门 / 玻璃门",
    CEILING: "集成吊顶",
    BATHROOM: "卫浴",
    SHOWER: "淋浴房",
    STONE: "石材 / 岩板",
    SWITCH: "开关面板",
    CUSTOM: "定制类",
  } as Record<string, string>)[code] ?? code;
}
