import type { HalfPackageQuotation } from "@shanyu/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  continueEditingQuotation,
  createQuotationExport,
  formatQuotationMoney,
  quotationLineUpdateForQuantity,
  saveQuotationLine,
  updateQuotationAdjustment,
  updateQuotationMarginBenchmark,
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

  it.each(["PDF", "XLSX"] as const)(
    "creates a %s export with the authenticated browser session",
    async (format) => {
      const exported = {
        downloadPath: `/quotation-exports/export-${format.toLowerCase()}`,
        fileName: `客户报价.${format === "PDF" ? "pdf" : "xlsx"}`,
        format,
        id: `export-${format.toLowerCase()}`,
        sha256: "a".repeat(64),
      };
      const fetcher = vi.fn<Fetcher>(async () =>
        new Response(JSON.stringify({ export: exported }), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      );

      await expect(
        createQuotationExport("quotation-id", format, fetcher),
      ).resolves.toEqual(exported);

      expect(fetcher).toHaveBeenCalledOnce();
      const options = fetcher.mock.calls[0]?.[1];
      expect(options).toMatchObject({
        credentials: "include",
        method: "POST",
      });
      expect(JSON.parse(String(options?.body))).toEqual({ format });
    },
  );

  it("returns the server error message for a rejected export", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ message: "报价尚未批准" }), {
        headers: { "content-type": "application/json" },
        status: 409,
      }),
    );

    await expect(
      createQuotationExport("quotation-id", "PDF", fetcher),
    ).rejects.toThrow("报价尚未批准");
  });

  it("continues editing an existing generated version with the browser session", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ quotation }), {
        headers: { "content-type": "application/json" },
        status: 201,
      }),
    );

    await expect(
      continueEditingQuotation("project-id", "quotation-id", fetcher),
    ).resolves.toEqual(quotation);
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      "/projects/project-id/half-package-quotation/versions/quotation-id/continue-editing",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      method: "POST",
    });
  });

  it("saves a quote adjustment with its optimistic revision and reason", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ quotation }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const input = {
      action: "SUBMIT_FOR_APPROVAL" as const,
      discountRate: "0.9500",
      expectedRevision: 3,
      reason: "客户确认折扣",
      writeOff: "100.0000",
    };

    await expect(
      updateQuotationAdjustment(
        "project-id",
        "quotation-id",
        input,
        fetcher,
      ),
    ).resolves.toEqual(quotation);
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      "/projects/project-id/half-package-quotation/versions/quotation-id/adjustment",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      method: "PATCH",
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(input);
  });

  it("updates the quotation gross-margin benchmark with credentials", async () => {
    const costMargin = {
      costVersion: { id: "catalog-id", versionNumber: 4 },
      expectedCost: "70.0000",
      grossMarginRate: "0.3000",
      grossProfit: "30.0000",
      id: "quotation-id",
      marginBenchmarkRate: "0.3200",
      projectAddress: "测试项目",
      projectId: "project-id",
      salesAmount: "100.0000",
      scopes: [],
      status: "QUOTED" as const,
      versionNumber: 1,
    };
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ costMargin }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await expect(
      updateQuotationMarginBenchmark(
        "project-id",
        "quotation-id",
        "32",
        fetcher,
      ),
    ).resolves.toEqual(costMargin);
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      "/projects/project-id/half-package-quotation/versions/quotation-id/margin-benchmark",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      method: "PATCH",
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      marginBenchmarkPercent: "32",
    });
  });
});

const quotation: HalfPackageQuotation = {
  adjustmentReason: null,
  adjustmentStatus: "AWAITING_SUBMISSION",
  adjustedTotal: "136.4000",
  directCost: "124.0000",
  discountRate: "1.0000",
  id: "quotation-id",
  managementFee: "12.4000",
  managementRate: "0.1000",
  isCurrent: true,
  projectId: "project-id",
  projectAddress: "上海市静安区测试路 1 号",
  revision: 3,
  scopes: [],
  status: "DRAFT",
  submittedAt: null,
  templateVersion: 1,
  total: "136.4000",
  versionNumber: 1,
  writeOff: "0.0000",
};

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
