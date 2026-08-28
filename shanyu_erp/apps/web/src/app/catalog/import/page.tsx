import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchPublishedCatalog, fetchSession } from "@/lib/api-client";

import { CatalogImportForm } from "./catalog-import-form";

export default async function CatalogImportPage() {
  const cookieHeader = (await cookies()).toString();
  const session = await fetchSession(cookieHeader);
  if (!session) {
    redirect("/login");
  }
  if (session.user.role !== "OWNER") {
    redirect("/catalog");
  }
  const currentCatalog = await fetchPublishedCatalog(cookieHeader);

  return (
    <AppShell active="catalog" user={session.user}>
      <main className="page-content catalog-import-page">
        <section className="page-title-row">
          <div>
            <p className="eyebrow">V1 · 半包标准工程项</p>
            <h1>主材库导入与发布</h1>
            <p>先完成 8 个分区、157 项、价格完整性与公式保留对算，再确认发布。</p>
          </div>
          <Link className="text-link" href="/catalog">返回主材库</Link>
        </section>

        <CatalogImportForm
          currentItemCount={currentCatalog?.items.length ?? 0}
          currentVersionNumber={currentCatalog?.versionNumber ?? null}
        />
      </main>
    </AppShell>
  );
}
