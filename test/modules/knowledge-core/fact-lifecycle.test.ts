import { describe, expect, it } from "vitest";
import {
  assertFactTransition,
  canFactTransition,
  INITIAL_FACT_STATUS,
} from "../../../src/modules/knowledge-core/fact-lifecycle.js";
import { InvalidStatusTransitionError } from "../../../src/lib/errors.js";

describe("fact lifecycle", () => {
  it("starts at PROPOSED", () => {
    expect(INITIAL_FACT_STATUS).toBe("PROPOSED");
  });

  it("allows the valid transitions", () => {
    expect(canFactTransition("PROPOSED", "ACCEPTED")).toBe(true);
    expect(canFactTransition("PROPOSED", "REJECTED")).toBe(true);
    expect(canFactTransition("ACCEPTED", "DEPRECATED")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canFactTransition("ACCEPTED", "PROPOSED")).toBe(false);
    expect(canFactTransition("REJECTED", "ACCEPTED")).toBe(false);
    expect(canFactTransition("DEPRECATED", "ACCEPTED")).toBe(false);
  });

  it("assertFactTransition throws on an illegal move", () => {
    expect(() => assertFactTransition("PROPOSED", "DEPRECATED")).toThrow(InvalidStatusTransitionError);
    expect(() => assertFactTransition("PROPOSED", "ACCEPTED")).not.toThrow();
  });
});
