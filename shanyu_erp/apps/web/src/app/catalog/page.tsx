import { cookies } from "next/headers";
import { FileUp } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchPublishedCatalog, fetchSession } from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";
import { quotationLineCategory } from "@/lib/quotation-view-model";

interface CatalogPageProps {
  readonly searchParams: Promise<{ section?: string }>;
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
  const catalog = await fetchPublishedCatalog(cookieHeader);
  const canViewCost = hasOwnerAccess;
  const selectedCode = (await searchParams).section;
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
          <span aria-disabled="true" className="catalog-tab">主材 SKU · 后续版本</span>
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

function formatPrice(value: string | undefined): string {
  return value ? Number(value).toFixed(2) : "—";
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
