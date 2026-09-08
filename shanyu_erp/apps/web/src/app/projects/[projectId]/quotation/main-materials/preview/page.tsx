import { cookies } from "next/headers";
import { ArrowLeft, CheckCircle2, Info } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchMainMaterialQuotation, fetchProject, fetchSession } from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { ExportMenu } from "../../../export-menu";

const categories = [
  ["TILE", "瓷砖"], ["SEAM", "美缝"], ["FLOOR", "木地板"],
  ["GLASS_DOOR", "房门 / 玻璃门"], ["CEILING", "集成吊顶"],
  ["BATHROOM", "卫浴"], ["SHOWER", "淋浴房"], ["STONE", "石材 / 岩板"],
  ["SWITCH", "开关面板"], ["CUSTOM", "定制类"],
] as const;

export default async function MainMaterialPreviewPage({ params }: { readonly params: Promise<{ projectId: string }> }) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) redirect("/login");
  const { projectId } = await params;
  const [quotation, project] = await Promise.all([
    fetchMainMaterialQuotation(cookieHeader, projectId),
    fetchProject(cookieHeader, projectId),
  ]);
  if (!quotation || !project) notFound();
  const selected = quotation.lines.filter((line) => line.item && Number(line.quantity) > 0);
  const missing = quotation.lines.filter((line) => line.origin === "AUTO_TILE" && !line.item).length;
  return <AppShell active="quotation" user={session.user}>
    <main className="workflow-page max-w-[1500px]">
      <header className="workflow-header">
        <div className="grid gap-1"><Link className="type-action flex w-fit items-center gap-1 text-muted-foreground hover:text-primary" href={`/projects/${projectId}/quotation/main-materials`}><ArrowLeft className="size-3.5" />返回主材选型</Link><div className="flex items-center gap-2"><h1 className="type-page-title">主材报价预览</h1><Badge variant="outline">客户版</Badge></div><p className="type-body m-0 text-muted-foreground">{project.projectAddress} · V{quotation.catalogVersion.versionNumber}</p></div>
        <div className="workflow-actions"><Button asChild variant="outline"><Link href={`/projects/${projectId}/quotation/main-materials`}>继续选型</Link></Button><ExportMenu allowInternal={hasOwnerPermissions(session.user.role)} disabled={quotation.status === "DRAFT"} fileNameStem={`${project.projectAddress}_项目报价单`} quotationId={quotation.id} /></div>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="主材直接费" value={money(quotation.summary.directCost)} /><Metric label="服务费（10%）" value={money(quotation.summary.managementFee)} /><Metric emphasis label="主材报价合计" value={money(quotation.summary.total)} /><Metric label="已选项目" value={`${selected.length} 项`} /></div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="overflow-hidden border-border py-0 shadow-none"><div className="border-b border-border px-4 py-3"><h2 className="type-section-title">主材报价明细表</h2><p className="type-support m-0 text-muted-foreground">仅显示数量大于 0 且已选型号的内容</p></div><div className="overflow-x-auto"><Table className="min-w-[900px]"><TableHeader><TableRow className="bg-muted"><TableHead>编号</TableHead><TableHead>主材 / 型号</TableHead><TableHead>规格</TableHead><TableHead>单位</TableHead><TableHead>数量</TableHead><TableHead>单价</TableHead><TableHead>金额</TableHead><TableHead>品牌 / 颜色</TableHead></TableRow></TableHeader><TableBody>{categories.flatMap(([code, name]) => { const lines = selected.filter((line) => line.categoryCode === code); if (!lines.length) return []; return [<TableRow className="bg-primary-soft hover:bg-primary-soft" key={`${code}-heading`}><TableCell className="font-semibold text-primary" colSpan={8}>【{name}】</TableCell></TableRow>, ...lines.map((line, index) => <TableRow key={line.id}><TableCell>{index + 1}</TableCell><TableCell><strong>{line.item?.itemName}</strong><span className="block text-xs text-muted-foreground">{line.item?.model}</span></TableCell><TableCell>{line.item?.spec || line.demandSpec}</TableCell><TableCell>{unit(line.item?.unit ?? "")}</TableCell><TableCell>{number(line.quantity)}</TableCell><TableCell>{money(line.item?.saleUnitPrice ?? "0")}</TableCell><TableCell className="font-semibold">{money(line.amount ?? "0")}</TableCell><TableCell>{[line.item?.brand, line.selectedColor].filter(Boolean).join(" · ") || "—"}</TableCell></TableRow>)]; })}</TableBody></Table></div></Card>
        <div className="grid h-fit gap-3"><Card className="border-border py-0 shadow-none"><CardContent className="grid gap-2 p-4"><h2 className="type-section-title">生成检查</h2>{missing ? <p className="type-support m-0 flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-warning"><Info className="mt-0.5 size-4 shrink-0" />还有 {missing} 条瓷砖需求未选择型号，不能统一确认。</p> : <p className="type-support m-0 flex gap-2 rounded-md bg-success-soft px-3 py-2 text-success"><CheckCircle2 className="size-4 shrink-0" />主材必选项检查通过</p>}<p className="type-support m-0 text-muted-foreground">导出的客户版 Excel 与 PDF 不包含成本字段。</p></CardContent></Card>{!missing && quotation.status === "DRAFT" ? <Button asChild><Link href={`/projects/${projectId}/quotation/submit`}>进入统一确认</Link></Button> : <Button disabled>进入统一确认</Button>}</div>
      </div>
    </main>
  </AppShell>;
}

function Metric({ emphasis = false, label, value }: { readonly emphasis?: boolean; readonly label: string; readonly value: string }) { return <Card className="border-border py-0 shadow-none"><CardContent className="grid gap-1 p-4"><span className="type-support text-muted-foreground">{label}</span><strong className={emphasis ? "text-2xl text-primary" : "text-2xl"}>{value}</strong></CardContent></Card>; }
function money(value: string) { return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function number(value: string) { return Number(value).toFixed(2); }
function unit(value: string) { return /^(m2|m²|㎡)$/i.test(value) ? "M²" : value; }
