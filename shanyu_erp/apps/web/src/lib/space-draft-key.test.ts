import { describe, expect, it } from "vitest";

import { createSpaceDraftKey } from "./space-draft-key";

describe("space draft key", () => {
  it("creates unique keys when randomUUID is unavailable", () => {
    const firstKey = createSpaceDraftKey({});
    const secondKey = createSpaceDraftKey({});

    expect(firstKey).toMatch(/^space-draft-\d+$/);
    expect(secondKey).toMatch(/^space-draft-\d+$/);
    expect(secondKey).not.toBe(firstKey);
  });
});
