import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_TYPES,
  createKnowledgeItemBodySchema,
  knowledgeIdSchema,
  knowledgeTypeSchema,
  newKnowledgeItemId,
  updateKnowledgeItemBodySchema,
} from "../../../src/modules/knowledge-core/entities.js";

describe("KNOWLEDGE_TYPES", () => {
  it("includes all seven knowledge types with Fact", () => {
    expect(KNOWLEDGE_TYPES).toEqual([
      "Decision",
      "Concept",
      "Procedure",
      "Troubleshooting",
      "Investigation",
      "Architecture",
      "Fact",
    ]);
    expect(knowledgeTypeSchema.safeParse("Fact").success).toBe(true);
  });
});

describe("knowledgeIdSchema", () => {
  it("accepts a generated id", () => {
    expect(knowledgeIdSchema.safeParse(newKnowledgeItemId()).success).toBe(true);
  });

  it("rejects other prefixes and malformed bodies", () => {
    expect(knowledgeIdSchema.safeParse("repo_01H").success).toBe(false);
    expect(knowledgeIdSchema.safeParse("know_lowercase").success).toBe(false);
  });
});

describe("createKnowledgeItemBodySchema", () => {
  const valid = { projectId: "proj_x", type: "Decision", title: "t", summary: "s" };

  it("defaults content to an empty object and leaves status unset", () => {
    const r = createKnowledgeItemBodySchema.parse(valid);
    expect(r.content).toEqual({});
    expect(r.status).toBeUndefined();
  });

  it("knows its seven types, in order", () => {
    expect(KNOWLEDGE_TYPES).toEqual([
      "Decision", "Concept", "Procedure", "Troubleshooting", "Investigation", "Architecture", "Fact",
    ]);
  });

  it("rejects an unknown type", () => {
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, type: "Bogus" }).success).toBe(false);
  });

  it("rejects missing or blank required fields", () => {
    expect(createKnowledgeItemBodySchema.safeParse({ type: "Decision", title: "t", summary: "s" }).success).toBe(false);
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, summary: "" }).success).toBe(false);
  });

  it("rejects unknown top-level keys (server-derived fields)", () => {
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, ownerId: "tok_x" }).success).toBe(false);
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, organizationId: "org_x" }).success).toBe(false);
  });

  it("accepts an optional status", () => {
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, status: "PROPOSED" }).success).toBe(true);
  });
});

describe("updateKnowledgeItemBodySchema", () => {
  it("accepts an empty object (the route enforces non-empty)", () => {
    expect(updateKnowledgeItemBodySchema.safeParse({}).success).toBe(true);
  });

  it("accepts a status-only patch", () => {
    expect(updateKnowledgeItemBodySchema.safeParse({ status: "PROPOSED" }).success).toBe(true);
  });

  it("rejects immutable fields", () => {
    expect(updateKnowledgeItemBodySchema.safeParse({ type: "Concept" }).success).toBe(false);
    expect(updateKnowledgeItemBodySchema.safeParse({ projectId: "proj_x" }).success).toBe(false);
    expect(updateKnowledgeItemBodySchema.safeParse({ version: 2 }).success).toBe(false);
  });
});
