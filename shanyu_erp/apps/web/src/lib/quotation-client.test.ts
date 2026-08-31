import type { HalfPackageQuotation } from "@shanyu/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  formatQuotationMoney,
  quotationLineUpdateForQuantity,
  saveQuotationLine,
} from "./quotation-client";

describe("quotation client", () => {
  it("formats server four-decimal amounts to two decimals", () => {
    expect(formatQuotationMoney("19.1348")).toBe("19.13");
    expect(formatQuotationMoney("19.1350")).toBe("19.14");
    expect(formatQuotationMoney("1.0050")).toBe("1.01");
    expect(formatQuotationMoney("0.0000")).toBe("0.00");
    expect(formatQuotationMoney("-39018.0824")).toBe("-39018.08");
    expect(formatQuotationMoney(null)).toBe("—");
  });

  it("clears selection and quantity when a manual quantity is emptied", () => {
    expect(quotationLineUpdateForQuantity("")).toEqual({
      quantity: null,
      selected: false,
    });
    expect(quotationLineUpdateForQuantity("  ")).toEqual({
      quantity: null,
      selected: false,
    });
    expect(quotationLineUpdateForQuantity("3.5000")).toEqual({
      quantity: "3.5000",
      selected: true,
    });
  });

  it("sends only selection, quantity, and optimistic revision", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ quotation }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await expect(
      saveQuotationLine(
        "project-id",
        "line-id",
        { expectedRevision: 2, quantity: "3.5000", selected: true },
        fetcher,
      ),
    ).resolves.toEqual(quotation);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      "/projects/project-id/half-package-quotation/lines/line-id",
    );
    const options = fetcher.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      credentials: "include",
      method: "PATCH",
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      expectedRevision: 2,
      quantity: "3.5000",
      selected: true,
    });
  });

  it("returns the server error message for a rejected save", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ message: "报价已被更新" }), {
        headers: { "content-type": "application/json" },
        status: 409,
      }),
    );

    await expect(
      saveQuotationLine(
        "project-id",
        "line-id",
        { expectedRevision: 0, quantity: null, selected: false },
        fetcher,
      ),
    ).rejects.toThrow("报价已被更新");
  });
});

const quotation: HalfPackageQuotation = {
  directCost: "124.0000",
  id: "quotation-id",
  managementFee: "12.4000",
  managementRate: "0.1000",
  projectId: "project-id",
  projectName: "静悦府",
  revision: 3,
  scopes: [],
  status: "DRAFT",
  submittedAt: null,
  templateVersion: 1,
  total: "136.4000",
  versionNumber: 1,
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
