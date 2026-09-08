import type {
  MainMaterialCategoryCode,
  MainMaterialCatalogUpdateCheckResponse,
  MainMaterialCatalogUpdateCheckView,
  MainMaterialImportBatchView,
  MainMaterialImportMode,
  MainMaterialImportResponse,
  MainMaterialQuotationResponse,
  MainMaterialQuotationView,
  PublishedMainMaterialCatalogResponse,
  PublishedMainMaterialCatalogView,
} from "@shanyu/contracts";

import { apiUrl } from "./api-url";

export async function selectMainMaterial(
  projectId: string,
  lineId: string,
  input: {
    readonly color: string | null;
    readonly expectedRevision: number;
    readonly itemVersionId: string;
    readonly quantity?: string;
  },
): Promise<MainMaterialQuotationView> {
  return quotationRequest(
    `${apiUrl}/projects/${projectId}/main-material-quotation/lines/${lineId}`,
    { body: JSON.stringify(input), method: "PATCH" },
  );
}

export async function addMainMaterialLine(
  projectId: string,
  input: {
    readonly categoryCode: Exclude<MainMaterialCategoryCode, "TILE">;
    readonly color: string | null;
    readonly expectedRevision: number;
    readonly itemVersionId: string;
    readonly quantity: string;
  },
): Promise<MainMaterialQuotationView> {
  return quotationRequest(
    `${apiUrl}/projects/${projectId}/main-material-quotation/lines`,
    { body: JSON.stringify(input), method: "POST" },
  );
}

export async function removeMainMaterialLine(
  projectId: string,
  lineId: string,
  expectedRevision: number,
): Promise<MainMaterialQuotationView> {
  return quotationRequest(
    `${apiUrl}/projects/${projectId}/main-material-quotation/lines/${lineId}?expectedRevision=${expectedRevision}`,
    { method: "DELETE" },
  );
}

export async function checkMainMaterialCatalogUpdate(
  projectId: string,
): Promise<MainMaterialCatalogUpdateCheckView> {
  const response = await fetch(
    `${apiUrl}/projects/${projectId}/main-material-quotation/catalog-update`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return ((await response.json()) as MainMaterialCatalogUpdateCheckResponse).check;
}

export async function refreshMainMaterialCatalog(
  projectId: string,
  expectedRevision: number,
): Promise<MainMaterialQuotationView> {
  return quotationRequest(
    `${apiUrl}/projects/${projectId}/main-material-quotation/catalog-update`,
    { body: JSON.stringify({ expectedRevision }), method: "POST" },
  );
}

export async function validateMainMaterialWorkbook(
  file: File,
  mode: MainMaterialImportMode,
): Promise<MainMaterialImportBatchView> {
  const form = new FormData();
  form.set("file", file);
  form.set("mode", mode);
  const response = await fetch(`${apiUrl}/catalog/main-materials/imports`, {
    body: form,
    credentials: "include",
    method: "POST",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return ((await response.json()) as MainMaterialImportResponse).batch;
}

export async function publishMainMaterialWorkbook(
  batchId: string,
): Promise<PublishedMainMaterialCatalogView> {
  const response = await fetch(
    `${apiUrl}/catalog/main-materials/imports/${batchId}/publish`,
    { credentials: "include", method: "POST" },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return ((await response.json()) as PublishedMainMaterialCatalogResponse).catalog;
}

export async function validateMainMaterialOnlineEdit(input: {
  readonly changeReason: string;
  readonly expectedRecordVersion: number;
  readonly materialId: string;
  readonly operation: "UPSERT" | "DEACTIVATE" | "REACTIVATE";
  readonly values: Readonly<Record<string, string | null>>;
}): Promise<MainMaterialImportBatchView> {
  const response = await fetch(`${apiUrl}/catalog/main-materials/online-edits`, {
    body: JSON.stringify(input),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return ((await response.json()) as MainMaterialImportResponse).batch;
}

async function quotationRequest(
  url: string,
  init: RequestInit,
): Promise<MainMaterialQuotationView> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return ((await response.json()) as MainMaterialQuotationResponse).quotation;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string | string[] };
    return Array.isArray(payload.message)
      ? payload.message.join("；")
      : payload.message ?? `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}
