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
  return <AppShell active="quotation" user={session.user}><main className="workflow-page max-w-[1450px]"><header className="workflow-header"><div className="grid gap-1"><Link className="type-action flex w-fit items-center gap-1 text-muted-foreground hover:text-primary" href={`/projects/${projectId}/quotation/main-materials`}><ArrowLeft className="size-3.5" />返回主材选型</Link><div className="flex items-center gap-2"><h1 className="type-page-title">主材成本分析</h1><Badge variant="outline">主材库 V{quotation.catalogVersion.versionNumber}</Badge></div><p className="type-body m-0 text-muted-foreground">{project.projectAddress}</p></div></header><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="主材报价" value={money(quotation.summary.total)} /><Metric label="预计成本" value={money(quotation.summary.expectedCost)} /><Metric label="预计毛利" value={money(quotation.summary.grossProfit ?? "0")} /><Metric label="毛利率" value={percent(quotation.summary.grossMarginRate)} /></div><Card className="overflow-hidden border-border py-0 shadow-none"><div className="border-b border-border px-4 py-3"><h2 className="type-section-title">主材成本明细</h2><p className="type-support m-0 text-muted-foreground">销售价与成本价均取自当前报价引用的版本快照</p></div><div className="overflow-x-auto"><Table className="min-w-[1000px]"><TableHeader><TableRow className="bg-muted"><TableHead>分类</TableHead><TableHead>品牌 / 型号</TableHead><TableHead>规格</TableHead><TableHead>数量</TableHead><TableHead>销售单价</TableHead><TableHead>销售金额</TableHead><TableHead>成本单价</TableHead><TableHead>成本金额</TableHead><TableHead>毛利</TableHead></TableRow></TableHeader><TableBody>{lines.map((line) => <TableRow key={line.id}><TableCell>{categoryName(line.categoryCode)}</TableCell><TableCell><strong>{line.item?.brand || line.item?.itemName}</strong><span className="block text-xs text-muted-foreground">{line.item?.model}</span></TableCell><TableCell>{line.item?.spec || "—"}</TableCell><TableCell>{Number(line.quantity).toFixed(2)}</TableCell><TableCell>{money(line.item?.saleUnitPrice ?? "0")}</TableCell><TableCell>{money(line.amount ?? "0")}</TableCell><TableCell>{money(line.item?.costUnitPrice ?? "0")}</TableCell><TableCell>{money(line.costAmount ?? "0")}</TableCell><TableCell className="font-semibold">{money(String(Number(line.amount ?? 0) - Number(line.costAmount ?? 0)))}</TableCell></TableRow>)}</TableBody></Table></div></Card></main></AppShell>;
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) { return <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-1 p-4"><span className="type-support text-muted-foreground">{label}</span><strong className="text-2xl">{value}</strong></CardContent></Card>; }
function money(value: string) { return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function percent(value: string | null | undefined) { return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(2)}%`; }
function categoryName(code: string) { return ({ TILE: "瓷砖", SEAM: "美缝", FLOOR: "木地板", GLASS_DOOR: "房门 / 玻璃门", CEILING: "集成吊顶", BATHROOM: "卫浴", SHOWER: "淋浴房", STONE: "石材 / 岩板", SWITCH: "开关面板", CUSTOM: "定制类" } as Record<string, string>)[code] ?? code; }
