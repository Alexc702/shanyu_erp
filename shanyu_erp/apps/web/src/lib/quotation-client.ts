import type {
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
