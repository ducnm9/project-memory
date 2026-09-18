import { describe, expect, it } from "vitest";
import { newTokenId, tokenIdSchema, createTokenBodySchema } from "../../../src/modules/auth/entities.js";

describe("newTokenId", () => {
  it("produces a tok_-prefixed id that passes tokenIdSchema", () => {
    const id = newTokenId();
    expect(id).toMatch(/^tok_/);
    expect(tokenIdSchema.safeParse(id).success).toBe(true);
  });
});

describe("tokenIdSchema", () => {
  it("rejects a malformed id", () => {
    expect(tokenIdSchema.safeParse("tok_bad").success).toBe(false);
    expect(tokenIdSchema.safeParse("nope").success).toBe(false);
  });
});

describe("createTokenBodySchema", () => {
  it("accepts a non-empty name and trims it", () => {
    const r = createTokenBodySchema.safeParse({ name: "  kiro-ci  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("kiro-ci");
  });

  it("rejects an empty name", () => {
    expect(createTokenBodySchema.safeParse({ name: " " }).success).toBe(false);
  });
});
