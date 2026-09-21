import type {
  HalfPackageApprovalDecision,
  HalfPackageExportFormat,
  HalfPackageExportJobRecord,
  HalfPackageExportRecord,
  HalfPackageExportResponse,
  HalfPackageCostMargin,
  HalfPackageCostMarginResponse,
  HalfPackageVersionCompareResponse,
  HalfPackageQuotation,
  HalfPackageQuotationResponse,
  UpdateHalfPackageQuotationLineRequest,
  UpdateHalfPackageAdjustmentRequest,
} from "@shanyu/contracts";

import { apiUrl } from "./api-url";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function saveQuotationLine(
  projectId: string,
  lineId: string,
  input: UpdateHalfPackageQuotationLineRequest,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageQuotation> {
  const response = await fetcher(
    `${apiUrl}/projects/${projectId}/half-package-quotation/lines/${lineId}`,
    {
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        quantity: input.quantity,
        selected: input.selected,
      }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : `保存失败（${response.status}）`,
    );
  }
  const payload = (await response.json()) as HalfPackageQuotationResponse;
  return payload.quotation;
}

export function quotationLineUpdateForQuantity(quantity: string): Pick<
  UpdateHalfPackageQuotationLineRequest,
  "quantity" | "selected"
> {
  const normalized = quantity.trim();
  return {
    quantity: normalized || null,
    selected: normalized !== "",
  };
}

export async function submitQuotation(
  projectId: string,
  expectedRevision: number,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageQuotation> {
  return quotationMutation(
    `${apiUrl}/projects/${projectId}/half-package-quotation/submit`,
    { expectedRevision },
    fetcher,
  );
}

export async function decideQuotation(
  quotationId: string,
  action: HalfPackageApprovalDecision,
  reason: string | null,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageQuotation> {
  return quotationMutation(
    `${apiUrl}/approvals/half-package/${quotationId}/decision`,
    { action, reason },
    fetcher,
  );
}

export async function continueEditingQuotation(
  projectId: string,
  quotationId: string,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageQuotation> {
  return quotationMutation(
    `${apiUrl}/projects/${projectId}/half-package-quotation/versions/${quotationId}/continue-editing`,
    {},
    fetcher,
  );
}

export async function updateQuotationAdjustment(
  projectId: string,
  quotationId: string,
  input: UpdateHalfPackageAdjustmentRequest,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageQuotation> {
  const response = await fetcher(
    `${apiUrl}/projects/${projectId}/half-package-quotation/versions/${quotationId}/adjustment`,
    {
      body: JSON.stringify(input),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
  if (!response.ok) throw await responseError(response, "保存折扣与抹零失败");
  return ((await response.json()) as HalfPackageQuotationResponse).quotation;
}

export async function updateDesignFee(projectId: string, unitPrice: string | null, expectedRevision: number, fetcher: Fetcher = fetch): Promise<HalfPackageQuotation> {
  const response = await fetcher(`${apiUrl}/projects/${projectId}/half-package-quotation/design-fee`, {
    body: JSON.stringify({ unitPrice, expectedRevision }), credentials: "include",
    headers: { "content-type": "application/json" }, method: "PATCH",
  });
  if (!response.ok) throw await responseError(response, "保存设计费失败");
  return ((await response.json()) as HalfPackageQuotationResponse).quotation;
}

export async function updateQuotationMarginBenchmark(
  projectId: string,
  quotationId: string,
  marginBenchmarkPercent: string,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageCostMargin> {
  const response = await fetcher(
    `${apiUrl}/projects/${projectId}/half-package-quotation/versions/${quotationId}/margin-benchmark`,
    {
      body: JSON.stringify({ marginBenchmarkPercent }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
  if (!response.ok) {
    throw await responseError(response, "保存基准毛利率失败");
  }
  return ((await response.json()) as HalfPackageCostMarginResponse).costMargin;
}

export async function createQuotationExport(
  quotationId: string,
  format: HalfPackageExportFormat,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(
    `${apiUrl}/approvals/half-package/${quotationId}/exports`,
    {
      body: JSON.stringify({ format }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw await responseError(response, "导出失败");
  return ((await response.json()) as HalfPackageExportResponse).job;
}

export async function getQuotationExportJob(
  statusPath: string,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageExportJobRecord> {
  const response = await fetcher(`${apiUrl}${statusPath}`, {
    credentials: "include",
  });
  if (!response.ok) throw await responseError(response, "查询导出进度失败");
  return ((await response.json()) as HalfPackageExportResponse).job;
}

export async function createSelectionSheetExport(quotationId: string, acceptPlaceholders: boolean, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${apiUrl}/approvals/half-package/${quotationId}/selection-sheet`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ acceptPlaceholders }),
  });
  if (!response.ok) throw await responseError(response, "生成选材单失败");
  return ((await response.json()) as HalfPackageExportResponse).job;
}

export async function latestSelectionSheetExport(quotationId: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`${apiUrl}/approvals/half-package/${quotationId}/selection-sheet`, { credentials: "include" });
  if (!response.ok) throw await responseError(response, "恢复选材单任务失败");
  return ((await response.json()) as { job: HalfPackageExportResponse["job"] | null }).job;
}

export async function fetchQuotationExportFile(
  exported: Pick<HalfPackageExportRecord, "downloadPath">,
  fetcher: Fetcher = fetch,
): Promise<Blob> {
  const response = await fetcher(`${apiUrl}${exported.downloadPath}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw await responseError(response, "下载导出文件失败");
  }
  return response.blob();
}

export async function waitForQuotationExport(
  initialJob: HalfPackageExportJobRecord,
  fetcher: Fetcher = fetch,
  pollIntervalMs = 750,
): Promise<HalfPackageExportRecord> {
  let job = initialJob;
  const expiresAt = Date.now() + 10 * 60 * 1_000;
  while (job.status === "PENDING" || job.status === "RUNNING") {
    if (Date.now() >= expiresAt) {
      throw new Error("导出仍在队列中，请稍后重试");
    }
    await delay(pollIntervalMs);
    job = await getQuotationExportJob(job.statusPath, fetcher);
  }
  if (job.status === "FAILED") {
    throw new Error(job.errorMessage ?? "导出失败");
  }
  if (!job.export) throw new Error("导出完成但文件不存在");
  return job.export;
}

export async function compareQuotationVersions(
  projectId: string,
  fromId: string,
  toId: string,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageVersionCompareResponse> {
  const response = await fetcher(
    `${apiUrl}/projects/${projectId}/half-package-quotation/versions/compare?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,
    { credentials: "include" },
  );
  if (!response.ok) throw await responseError(response, "版本对比失败");
  return (await response.json()) as HalfPackageVersionCompareResponse;
}

async function quotationMutation(
  url: string,
  body: Readonly<Record<string, unknown>>,
  fetcher: Fetcher,
): Promise<HalfPackageQuotation> {
  const response = await fetcher(url, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw await responseError(response, "操作失败");
  return ((await response.json()) as HalfPackageQuotationResponse).quotation;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const error = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return new Error(typeof error?.message === "string" ? error.message : `${fallback}（${response.status}）`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function formatQuotationMoney(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const match = /^(-?)(\d+)\.(\d{4})$/.exec(value);
  if (!match?.[2] || !match[3]) {
    throw new Error(`服务端金额格式无效：${value}`);
  }
  const hundred = BigInt(100);
  const scaled = BigInt(match[2]) * BigInt(10_000) + BigInt(match[3]);
  const cents = (scaled + BigInt(50)) / hundred;
  return `${match[1]}${cents / hundred}.${(cents % hundred).toString().padStart(2, "0")}`;
}

export function discountRateToWholePercent(value: string): string {
  const match = /^(0|1)\.(\d{4})$/.exec(value);
  if (!match?.[1] || !match[2]) {
    throw new Error(`服务端折扣格式无效：${value}`);
  }
  const hundred = BigInt(100);
  const units = BigInt(match[1]) * BigInt(10_000) + BigInt(match[2]);
  if (units > BigInt(10_000) || units % hundred !== BigInt(0)) {
    throw new Error(`服务端折扣不是整数百分比：${value}`);
  }
  return (units / hundred).toString();
}

export function isValidDiscountPercent(value: string): boolean {
  return /^\d{1,3}$/.test(value) && Number(value) <= 100;
}

export function halfPackageRealtimeTotal(
  quotation: Pick<HalfPackageQuotation, "halfPackageTotal">,
): string {
  if (quotation.halfPackageTotal === undefined) {
    throw new Error("服务端未返回半包金额");
  }
  return quotation.halfPackageTotal;
}
