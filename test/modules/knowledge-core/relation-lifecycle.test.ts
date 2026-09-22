import { describe, expect, it } from "vitest";
import {
  INITIAL_RELATION_STATUS,
  canRelationTransition,
  assertRelationTransition,
} from "../../../src/modules/knowledge-core/relation-lifecycle.js";
import { InvalidStatusTransitionError } from "../../../src/lib/errors.js";

describe("relation-lifecycle", () => {
  it("starts at PROPOSED", () => {
    expect(INITIAL_RELATION_STATUS).toBe("PROPOSED");
  });

  it("allows PROPOSED -> ACCEPTED and PROPOSED -> REJECTED", () => {
    expect(canRelationTransition("PROPOSED", "ACCEPTED")).toBe(true);
    expect(canRelationTransition("PROPOSED", "REJECTED")).toBe(true);
  });

  it("allows ACCEPTED -> DEPRECATED", () => {
    expect(canRelationTransition("ACCEPTED", "DEPRECATED")).toBe(true);
  });

  it("treats REJECTED and DEPRECATED as terminal", () => {
    expect(canRelationTransition("REJECTED", "ACCEPTED")).toBe(false);
    expect(canRelationTransition("DEPRECATED", "ACCEPTED")).toBe(false);
  });

  it("throws on an illegal transition", () => {
    expect(() => assertRelationTransition("PROPOSED", "DEPRECATED")).toThrow(InvalidStatusTransitionError);
  });
});
