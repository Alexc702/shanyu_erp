import { describe, expect, it, vi } from "vitest";

import { fetchHealth } from "./health-client";

describe("fetchHealth", () => {
  it("uses the NestJS health endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    await expect(fetchHealth(fetcher)).resolves.toEqual({ status: "ok" });
    expect(fetcher).toHaveBeenCalledWith("http://localhost:3001/health");
  });
});
