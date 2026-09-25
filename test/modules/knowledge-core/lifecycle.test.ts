import { describe, expect, it } from "vitest";
import {
  INITIAL_STATUSES,
  assertTransition,
  canTransition,
  isInitialStatus,
} from "../../../src/modules/knowledge-core/lifecycle.js";
import { KNOWLEDGE_STATUSES, type KnowledgeStatus } from "../../../src/modules/knowledge-core/entities.js";

const LEGAL: Array<[KnowledgeStatus, KnowledgeStatus]> = [
  ["DISCOVERED", "PROPOSED"],
  ["PROPOSED", "VALIDATING"],
  ["VALIDATING", "REJECTED"],
  ["VALIDATING", "ACCEPTED"],
  ["ACCEPTED", "PUBLISHED"],
  ["PUBLISHED", "UPDATED"],
  ["PUBLISHED", "STALE"],
  ["PUBLISHED", "DEPRECATED"],
];

describe("canTransition", () => {
  it("allows every legal edge", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("rejects representative illegal edges", () => {
    expect(canTransition("PUBLISHED", "DISCOVERED")).toBe(false);
    expect(canTransition("DISCOVERED", "PUBLISHED")).toBe(false);
    expect(canTransition("PROPOSED", "ACCEPTED")).toBe(false);
    expect(canTransition("REJECTED", "PROPOSED")).toBe(false);
  });

  it("has no self-edges", () => {
    for (const status of KNOWLEDGE_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it("treats REJECTED / UPDATED / DEPRECATED as terminal", () => {
    const terminal: KnowledgeStatus[] = ["REJECTED", "UPDATED", "DEPRECATED"];
    for (const from of terminal) {
      for (const to of KNOWLEDGE_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });
});

describe("assertTransition", () => {
  it("throws 422 INVALID_STATUS_TRANSITION for an illegal edge", () => {
    try {
      assertTransition("PUBLISHED", "DISCOVERED");
      throw new Error("expected assertTransition to throw");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(422);
      expect((err as { code?: string }).code).toBe("INVALID_STATUS_TRANSITION");
    }
  });

  it("does not throw for a legal edge", () => {
    expect(() => assertTransition("ACCEPTED", "PUBLISHED")).not.toThrow();
  });
});

describe("initial statuses", () => {
  it("is exactly DISCOVERED and PROPOSED", () => {
    expect([...INITIAL_STATUSES]).toEqual(["DISCOVERED", "PROPOSED"]);
    expect(isInitialStatus("DISCOVERED")).toBe(true);
    expect(isInitialStatus("PROPOSED")).toBe(true);
    expect(isInitialStatus("ACCEPTED")).toBe(false);
    expect(isInitialStatus("PUBLISHED")).toBe(false);
  });
});
