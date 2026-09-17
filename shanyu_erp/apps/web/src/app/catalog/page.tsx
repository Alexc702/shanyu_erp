import { cookies } from "next/headers";
import { Boxes, FileUp, ImageOff, PackageCheck, PackageX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchPublishedCatalog, fetchPublishedMainMaterialCatalog, fetchSession } from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";
import { quotationLineCategory } from "@/lib/quotation-view-model";

import { MainMaterialCatalogTable } from "./main-material-catalog-table";

interface CatalogPageProps {
  readonly searchParams: Promise<{ section?: string; type?: string }>;
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  const hasOwnerAccess = hasOwnerPermissions(session.user.role);
  if (!hasOwnerAccess && session.user.role !== "LEAD_DESIGNER") {
    redirect("/");
  }
  const resolvedSearch = await searchParams;
  if (resolvedSearch.type === "main") {
    const mainCatalog = await fetchPublishedMainMaterialCatalog(cookieHeader);
    return (
      <AppShell active="catalog" user={session.user}>
        <MainMaterialCatalog
          canViewCost={hasOwnerAccess}
          catalog={mainCatalog}
          selectedCode={resolvedSearch.section}
        />
      </AppShell>
    );
  }
  const catalog = await fetchPublishedCatalog(cookieHeader);
  const canViewCost = hasOwnerAccess;
  const selectedCode = resolvedSearch.section;
  const selectedSection =
    catalog?.sections.find((section) => section.code === selectedCode) ??
    catalog?.sections[0];
  const items = selectedSection
    ? catalog?.items.filter((item) => item.sectionName === selectedSection.name) ?? []
    : [];

  return (
    <AppShell active="catalog" user={session.user}>
      <main className="page-content catalog-page">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">V1 · 主材库</p>
            <h1>主材库</h1>
            <p>集中维护半包工程项的销售价、成本价与版本；V1 仅开放半包工程项。</p>
          </div>
          {hasOwnerAccess ? (
            <Button asChild><Link href="/catalog/import"><FileUp />导入 Excel</Link></Button>
          ) : null}
        </section>

        <nav className="catalog-tabs" aria-label="主材库类型">
          <Link className="catalog-tab active" href="/catalog">半包工程项</Link>
          <Link className="catalog-tab" href="/catalog?type=main">主材 SKU</Link>
        </nav>

        {!catalog || !selectedSection ? (
          <section className="panel empty-panel">
            <h2>尚无已发布版本</h2>
            <p>{canViewCost ? "请导入并发布半包报价 Excel。" : "请等待老板发布半包工程项版本。"}</p>
          </section>
        ) : (
          <>
            <div className="catalog-version-strip">
              <Badge variant="success">当前生效</Badge>
              <span>
                V{catalog.versionNumber} · {catalog.sections.length} 个章节 · {catalog.items.length} 个工程项 · {formatPublishedAt(catalog.publishedAt)} 发布
              </span>
            </div>

            <div className="catalog-layout">
              <aside className="catalog-section-nav">
                <h2>章节</h2>
                {catalog.sections.map((section) => (
                  <Link
                    className={section.id === selectedSection.id ? "catalog-section-link active" : "catalog-section-link"}
                    href={`/catalog?section=${section.code}`}
                    key={section.id}
                  >
                    <span>{section.name}</span>
                    <span>{section.itemCount}项</span>
                  </Link>
                ))}
              </aside>

              <section className="panel catalog-section">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">当前章节</p>
                    <h2>{selectedSection.name}</h2>
                    <p>{items.length} 项 · 同名工程项允许因章节与口径不同设置不同价格</p>
                  </div>
                  {canViewCost ? <Badge variant="outline">销售价 / 成本价</Badge> : null}
                </div>
                <div className="table-wrap catalog-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>工程项</th>
                        <th>分类</th>
                        <th>单位</th>
                        <th>数量依据</th>
                        <th>销售价</th>
                        {canViewCost ? <th>成本价</th> : null}
                        <th>施工说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td><strong>{item.itemName}</strong></td>
                          <td>{quotationLineCategory(item.itemName, item.sectionName)}</td>
                          <td>{/^m2$/i.test(item.unit) ? "M²" : item.unit}</td>
                          <td>{item.quantityFormula ? <span className="formula-pill">Excel 公式已保留</span> : "手工填写"}</td>
                          <td>¥ {formatPrice(item.saleUnitPrice)}</td>
                          {canViewCost ? <td>¥ {formatPrice(item.costUnitPrice)}</td> : null}
                          <td className="catalog-remarks">{item.remarks ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

function MainMaterialCatalog({
  canViewCost,
  catalog,
  selectedCode,
}: {
  readonly canViewCost: boolean;
  readonly catalog: Awaited<ReturnType<typeof fetchPublishedMainMaterialCatalog>>;
  readonly selectedCode?: string;
}) {
  const showAll = !selectedCode || selectedCode === "ALL";
  const selected = showAll
    ? null
    : catalog?.categories.find((candidate) => candidate.code === selectedCode) ?? null;
  const items = catalog
    ? selected
      ? catalog.items.filter((item) => item.categoryCode === selected.code)
      : catalog.items
    : [];
  const activeCount = catalog?.items.filter((item) => item.status === "ACTIVE").length ?? 0;
  const pendingCount = catalog?.items.filter((item) => item.status === "PENDING_DATA").length ?? 0;
  const inactiveCount = catalog?.items.filter((item) => item.status === "INACTIVE").length ?? 0;
  const missingImageCount = catalog?.items.filter((item) => item.assets.length === 0).length ?? 0;
  return <main className="page-content catalog-page max-w-[1600px]">
    <section className="page-title-row"><div><p className="eyebrow">V2 · 主材 SKU</p><h1>主材库</h1><p>{catalog ? `当前版本 V${catalog.versionNumber} · 已发布 · 商品、价格、成本、图片与来源按版本追溯` : "集中维护主材型号、规格、颜色、价格与来源图片。"}</p></div>{canViewCost ? <Button asChild><Link href="/catalog/import?type=main"><FileUp />导入与发布</Link></Button> : null}</section>
    <nav className="catalog-tabs" aria-label="主材库类型"><Link className="catalog-tab" href="/catalog">半包工程项</Link><Link className="catalog-tab active" href="/catalog?type=main">主材 SKU</Link></nav>
    {!catalog ? <section className="panel empty-panel"><h2>尚无已发布主材版本</h2><p>主材库发布后可用于项目选型。</p></section> : <>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <CatalogMetric icon={<Boxes />} label="总记录" note={`${catalog.categories.length} 个商品分类`} value={catalog.items.length} />
        <CatalogMetric icon={<PackageCheck />} label="可选 ACTIVE" note="可用于新报价" tone="success" value={activeCount} />
        <CatalogMetric icon={<TriangleAlert />} label="待补资料" note="不可用于新报价" tone="warning" value={pendingCount} />
        <CatalogMetric icon={<ImageOff />} label="缺少产品图" note="列表使用占位状态" value={missingImageCount} />
        <CatalogMetric icon={<PackageX />} label="已停用" note="保留历史记录" value={inactiveCount} />
      </div>
      <div className="catalog-version-strip"><Badge variant="success">当前生效</Badge><span>V{catalog.versionNumber} · {formatPublishedAt(catalog.publishedAt)} 发布</span></div>
      <div className="catalog-layout"><aside className="catalog-section-nav"><h2>主材分类</h2><Link className={showAll ? "catalog-section-link active" : "catalog-section-link"} href="/catalog?type=main"><span>全部主材</span><span>{catalog.items.length}项</span></Link>{catalog.categories.map((category) => <Link className={category.code === selected?.code ? "catalog-section-link active" : "catalog-section-link"} href={`/catalog?type=main&section=${category.code}`} key={category.code}><span>{category.name}</span><span>{category.itemCount}项</span></Link>)}</aside><section className="panel catalog-section"><div className="panel-heading"><div><p className="eyebrow">{selected ? "当前分类" : "全部记录"}</p><h2>{selected?.name ?? "全部主材"}</h2><p>{items.length} 条 · 待补资料记录不会进入项目选型</p></div><Badge variant="outline">主材库 V{catalog.versionNumber}</Badge></div><MainMaterialCatalogTable canManage={canViewCost} items={items} /></section></div>
    </>}
  </main>;
}

function CatalogMetric({ icon, label, note, tone = "default", value }: { readonly icon: ReactNode; readonly label: string; readonly note: string; readonly tone?: "default" | "success" | "warning"; readonly value: number }) {
  return <section className="flex min-h-20 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs"><span className={tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-primary"}>{icon}</span><div className="min-w-0"><span className="type-support block text-muted-foreground">{label}</span><strong className="block text-2xl leading-7">{value}</strong><span className="type-support block truncate text-muted-foreground">{note}</span></div></section>;
}

function formatPrice(value: string | undefined): string {
  return value ? Number(value).toFixed(2) : "—";
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
