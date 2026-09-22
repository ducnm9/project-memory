import { describe, expect, it } from "vitest";
import {
  FACT_STATUSES,
  createFactBodySchema,
  updateFactBodySchema,
  factIdSchema,
  newFactId,
} from "../../../src/modules/knowledge-core/fact-entities.js";

describe("FACT_STATUSES", () => {
  it("is the compact four-state set", () => {
    expect(FACT_STATUSES).toEqual(["PROPOSED", "ACCEPTED", "REJECTED", "DEPRECATED"]);
  });
});

describe("factIdSchema", () => {
  it("accepts a generated id and rejects other prefixes", () => {
    expect(factIdSchema.safeParse(newFactId()).success).toBe(true);
    expect(factIdSchema.safeParse("know_01H").success).toBe(false);
    expect(factIdSchema.safeParse("fact_lowercase").success).toBe(false);
  });
});

describe("createFactBodySchema", () => {
  const valid = { projectId: "proj_x", subjectId: "matter-history", predicate: "depends_on", objectId: "audit-log" };

  it("accepts a full triple", () => {
    expect(createFactBodySchema.safeParse(valid).success).toBe(true);
  });

  it("requires all three triple fields", () => {
    expect(createFactBodySchema.safeParse({ projectId: "proj_x", subjectId: "s", predicate: "p" }).success).toBe(false);
    expect(createFactBodySchema.safeParse({ ...valid, subjectId: "  " }).success).toBe(false);
  });

  it("rejects status and sourceIds at creation (strict)", () => {
    expect(createFactBodySchema.safeParse({ ...valid, status: "ACCEPTED" }).success).toBe(false);
    expect(createFactBodySchema.safeParse({ ...valid, sourceIds: [] }).success).toBe(false);
  });
});

describe("updateFactBodySchema", () => {
  it("accepts a status-only patch and a triple-field patch", () => {
    expect(updateFactBodySchema.safeParse({ status: "ACCEPTED" }).success).toBe(true);
    expect(updateFactBodySchema.safeParse({ predicate: "impacts" }).success).toBe(true);
  });

  it("rejects immutable fields", () => {
    expect(updateFactBodySchema.safeParse({ projectId: "proj_x" }).success).toBe(false);
    expect(updateFactBodySchema.safeParse({ version: 2 }).success).toBe(false);
  });
});
