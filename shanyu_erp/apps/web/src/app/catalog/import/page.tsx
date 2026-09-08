import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchPublishedCatalog, fetchPublishedMainMaterialCatalog, fetchSession } from "@/lib/api-client";
import { hasOwnerPermissions } from "@/lib/permissions";

import { CatalogImportForm } from "./catalog-import-form";
import { MainMaterialImportForm } from "./main-material-import-form";

export default async function CatalogImportPage({ searchParams }: { readonly searchParams: Promise<{ type?: string }> }) {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  if (!hasOwnerPermissions(session.user.role)) {
    redirect("/catalog");
  }
  const mainMaterial = (await searchParams).type === "main";
  const currentCatalog = mainMaterial
    ? await fetchPublishedMainMaterialCatalog(cookieHeader)
    : await fetchPublishedCatalog(cookieHeader);

  return (
    <AppShell active="catalog" user={session.user}>
      <main className="page-content catalog-import-page">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">{mainMaterial ? "V2 · 主材 SKU" : "V1 · 半包标准工程项"}</p>
            <h1>主材库导入与发布</h1>
            <p>{mainMaterial ? "支持全量与 Delta 校验，确认差异后发布新的不可变版本。" : "先完成 8 个分区、178 项、价格完整性与公式保留对算，再确认发布。"}</p>
          </div>
          <Link className="text-link" href={mainMaterial ? "/catalog?type=main" : "/catalog"}>返回主材库</Link>
        </section>

        {mainMaterial ? <MainMaterialImportForm currentItemCount={currentCatalog?.items.length ?? 0} currentVersionNumber={currentCatalog?.versionNumber ?? null} /> : <CatalogImportForm currentItemCount={currentCatalog?.items.length ?? 0} currentVersionNumber={currentCatalog?.versionNumber ?? null} />}
      </main>
    </AppShell>
  );
}
