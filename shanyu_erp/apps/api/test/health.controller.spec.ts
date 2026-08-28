import { describe, expect, it } from "vitest";

import { HealthController } from "../src/health.controller";

describe("HealthController", () => {
  it("reports that the API is healthy", () => {
    expect(new HealthController().getHealth()).toEqual({ status: "ok" });
  });
});
