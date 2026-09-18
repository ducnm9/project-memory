import { describe, expect, it } from "vitest";
import { generateSecret, hashSecret, SECRET_PREFIX } from "../../../src/modules/auth/secret.js";

describe("generateSecret", () => {
  it("produces a pmk_-prefixed secret and a matching 12-char prefix", () => {
    const { secret, prefix } = generateSecret();
    expect(secret.startsWith(SECRET_PREFIX)).toBe(true);
    // prefix = "pmk_" (4) + 8 chars of the random part
    expect(prefix).toHaveLength(12);
    expect(secret.startsWith(prefix)).toBe(true);
  });

  it("produces unique secrets", () => {
    expect(generateSecret().secret).not.toBe(generateSecret().secret);
  });
});

describe("hashSecret", () => {
  it("is deterministic for the same secret and pepper", () => {
    expect(hashSecret("pmk_abc", "pepper")).toBe(hashSecret("pmk_abc", "pepper"));
  });

  it("differs when the pepper differs", () => {
    expect(hashSecret("pmk_abc", "p1")).not.toBe(hashSecret("pmk_abc", "p2"));
  });

  it("differs when the secret differs", () => {
    expect(hashSecret("pmk_a", "p")).not.toBe(hashSecret("pmk_b", "p"));
  });

  it("returns a 64-char hex string (sha256)", () => {
    expect(hashSecret("pmk_abc", "p")).toMatch(/^[0-9a-f]{64}$/);
  });
});
