import type {
  HalfPackageApprovalDecision,
  HalfPackageExportFormat,
  HalfPackageExportResponse,
  HalfPackageVersionCompareResponse,
  HalfPackageQuotation,
  HalfPackageQuotationResponse,
  UpdateHalfPackageQuotationLineRequest,
} from "@shanyu/contracts";

import { apiUrl } from "./api-client";

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

export async function cloneQuotationVersion(
  projectId: string,
  quotationId: string,
  fetcher: Fetcher = fetch,
): Promise<HalfPackageQuotation> {
  return quotationMutation(
    `${apiUrl}/projects/${projectId}/half-package-quotation/versions/${quotationId}/clone`,
    {},
    fetcher,
  );
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
  return ((await response.json()) as HalfPackageExportResponse).export;
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
