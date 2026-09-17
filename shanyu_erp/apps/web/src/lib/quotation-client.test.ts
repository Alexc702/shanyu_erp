import type { HalfPackageQuotation } from "@shanyu/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  continueEditingQuotation,
  createQuotationExport,
  discountRateToWholePercent,
  fetchQuotationExportFile,
  waitForQuotationExport,
  formatQuotationMoney,
  halfPackageRealtimeTotal,
  isValidDiscountPercent,
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

  it("uses only the half-package amount for the realtime half-package total", () => {
    expect(halfPackageRealtimeTotal({ halfPackageTotal: "61567.0000" })).toBe(
      "61567.0000",
    );
    expect(() => halfPackageRealtimeTotal({})).toThrow("服务端未返回半包金额");
  });

  it("accepts only whole discount percentages from 0 through 100", () => {
    expect(isValidDiscountPercent("0")).toBe(true);
    expect(isValidDiscountPercent("95")).toBe(true);
    expect(isValidDiscountPercent("100")).toBe(true);
    expect(isValidDiscountPercent("99.5")).toBe(false);
    expect(isValidDiscountPercent("101")).toBe(false);
    expect(isValidDiscountPercent("")).toBe(false);
  });

  it("converts stored discount rates to integer percentages exactly", () => {
    expect(discountRateToWholePercent("0.0000")).toBe("0");
    expect(discountRateToWholePercent("0.2900")).toBe("29");
    expect(discountRateToWholePercent("1.0000")).toBe("100");
    expect(() => discountRateToWholePercent("0.2950")).toThrow(
      "服务端折扣不是整数百分比",
    );
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
        audience: "CLIENT" as const,
        downloadPath: `/quotation-exports/export-${format.toLowerCase()}`,
        fileName: `客户报价.${format === "PDF" ? "pdf" : "xlsx"}`,
        format,
        id: `export-${format.toLowerCase()}`,
        sha256: "a".repeat(64),
      };
      const job = {
        audience: "CLIENT" as const,
        errorMessage: null,
        export: exported,
        format,
        id: `job-${format.toLowerCase()}`,
        status: "SUCCEEDED" as const,
        statusPath: `/quotation-export-jobs/job-${format.toLowerCase()}`,
      };
      const fetcher = vi.fn<Fetcher>(async () =>
        new Response(JSON.stringify({ job }), {
          headers: { "content-type": "application/json" },
          status: 202,
        }),
      );

      await expect(
        createQuotationExport("quotation-id", format, fetcher),
      ).resolves.toEqual(job);

      expect(fetcher).toHaveBeenCalledOnce();
      const options = fetcher.mock.calls[0]?.[1];
      expect(options).toMatchObject({
        credentials: "include",
        method: "POST",
      });
      expect(JSON.parse(String(options?.body))).toEqual({ format });
    },
  );

  it("polls an export job until the file is ready", async () => {
    const exported = {
      audience: "CLIENT" as const,
      downloadPath: "/quotation-exports/export-pdf",
      fileName: "客户报价.pdf",
      format: "PDF" as const,
      id: "export-pdf",
      sha256: "a".repeat(64),
    };
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({
        job: {
          audience: "CLIENT",
          errorMessage: null,
          export: exported,
          format: "PDF",
          id: "job-pdf",
          status: "SUCCEEDED",
          statusPath: "/quotation-export-jobs/job-pdf",
        },
      }), { headers: { "content-type": "application/json" } }),
    );

    await expect(waitForQuotationExport({
      audience: "CLIENT",
      errorMessage: null,
      export: null,
      format: "PDF",
      id: "job-pdf",
      status: "PENDING",
      statusPath: "/quotation-export-jobs/job-pdf",
    }, fetcher, 0)).resolves.toEqual(exported);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("downloads each completed export with the authenticated browser session", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response("export-content", {
        headers: { "content-type": "application/octet-stream" },
      }),
    );

    const blob = await fetchQuotationExportFile({
      downloadPath: "/quotation-exports/export-xlsx",
    }, fetcher);

    expect(await blob.text()).toBe("export-content");
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/quotation-exports/export-xlsx"),
      { credentials: "include" },
    );
  });

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
