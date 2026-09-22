import { describe, expect, it } from "vitest";
import {
  RELATION_PREDICATES,
  createRelationBodySchema,
  updateRelationBodySchema,
  relationIdSchema,
  newRelationId,
} from "../../../src/modules/knowledge-core/relation-entities.js";

describe("relation-entities", () => {
  const valid = { projectId: "prj_x", subjectId: "a", predicate: "depends_on", objectId: "b" };

  it("has the 11 domain predicates in order", () => {
    expect(RELATION_PREDICATES).toEqual([
      "depends_on", "implemented_by", "defined_by", "related_to",
      "supersedes", "contradicts", "derived_from", "documents",
      "fixes", "impacts", "owned_by",
    ]);
  });

  it("accepts a valid create body", () => {
    expect(createRelationBodySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an off-vocabulary predicate", () => {
    expect(createRelationBodySchema.safeParse({ ...valid, predicate: "causes" }).success).toBe(false);
  });

  it("rejects a status supplied at creation (strict)", () => {
    expect(createRelationBodySchema.safeParse({ ...valid, status: "ACCEPTED" }).success).toBe(false);
  });

  it("rejects a reviewerId in the patch body (strict)", () => {
    expect(updateRelationBodySchema.safeParse({ reviewerId: "tok_1" }).success).toBe(false);
  });

  it("accepts a status-only patch", () => {
    expect(updateRelationBodySchema.safeParse({ status: "ACCEPTED" }).success).toBe(true);
  });

  it("mints ids matching the id schema", () => {
    expect(relationIdSchema.safeParse(newRelationId()).success).toBe(true);
  });
});
