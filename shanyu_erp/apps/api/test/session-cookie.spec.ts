import { describe, expect, it } from "vitest";

import { isSessionCookieSecure } from "../src/access/session-cookie";

describe("session cookie transport security", () => {
  it("defaults to secure cookies in production", () => {
    expect(isSessionCookieSecure({ NODE_ENV: "production" })).toBe(true);
  });

  it("allows the explicit HTTP test-server override", () => {
    expect(
      isSessionCookieSecure({
        NODE_ENV: "production",
        SESSION_COOKIE_SECURE: "false",
      }),
    ).toBe(false);
  });

  it("rejects ambiguous configuration", () => {
    expect(() =>
      isSessionCookieSecure({ SESSION_COOKIE_SECURE: "yes" }),
    ).toThrow("SESSION_COOKIE_SECURE 必须是 true 或 false");
  });
});
