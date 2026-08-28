import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchPublishedCatalog, fetchSession } from "@/lib/api-client";

export default async function CatalogPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  if (
    session.user.role !== "OWNER" &&
    session.user.role !== "LEAD_DESIGNER"
  ) {
    redirect("/");
  }
  const catalog = await fetchPublishedCatalog(cookieHeader);
  const canViewCost = session.user.role === "OWNER";

  return (
    <AppShell active="catalog" user={session.user}>
      <main className="page-content catalog-page">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">V1 · 半包标准工程项</p>
            <h1>主材库</h1>
            <p>V1 仅管理半包工程项；数量公式原样保留，本阶段不自动计算。</p>
          </div>
          {session.user.role === "OWNER" ? (
            <Link className="primary-button inline-button" href="/catalog/import">
              导入 Excel
            </Link>
          ) : null}
        </section>

        {!catalog ? (
          <section className="panel empty-panel">
            <h2>尚无已发布版本</h2>
            <p>
              {session.user.role === "OWNER"
                ? "请导入并发布已确认的半包报价 Excel。"
                : "请等待老板发布半包工程项版本。"}
            </p>
          </section>
        ) : (
          <>
            <section className="catalog-summary-grid" aria-label="版本概览">
              <article className="metric-card">
                <p>当前版本</p>
                <strong>V{catalog.versionNumber}</strong>
                <small>{formatPublishedAt(catalog.publishedAt)} 发布</small>
              </article>
              <article className="metric-card">
                <p>报价分区</p>
                <strong>{catalog.sections.length}</strong>
                <small>与源 Excel 分区对算</small>
              </article>
              <article className="metric-card">
                <p>标准工程项</p>
                <strong>{catalog.items.length}</strong>
                <small>{canViewCost ? "销售价与成本价可见" : "仅显示销售价"}</small>
              </article>
            </section>

            <section className="catalog-sections">
              {catalog.sections.map((section) => {
                const items = catalog.items.filter(
                  (item) => item.sectionName === section.name,
                );
                return (
                  <article className="panel catalog-section" key={section.id}>
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">报价分区</p>
                        <h2>{section.name}</h2>
                      </div>
                      <span className="catalog-count">{items.length} 项</span>
                    </div>
                    <div className="table-wrap catalog-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>工程项</th>
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
                              <td>{item.unit}</td>
                              <td>
                                {item.quantityFormula ? (
                                  <span className="formula-pill">公式已保留</span>
                                ) : (
                                  item.rawQuantity ?? "—"
                                )}
                              </td>
                              <td>¥ {formatPrice(item.saleUnitPrice)}</td>
                              {canViewCost ? (
                                <td>¥ {formatPrice(item.costUnitPrice)}</td>
                              ) : null}
                              <td className="catalog-remarks">{item.remarks ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </section>
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
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
