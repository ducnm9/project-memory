import { describe, expect, it } from "vitest";
import { newKnowledgeVersionId, knowledgeVersionIdSchema } from "../../../src/modules/knowledge-core/version-entities.js";

describe("version-entities", () => {
  it("generates a kver_ prefixed id", () => {
    const id = newKnowledgeVersionId();
    expect(id).toMatch(/^kver_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("knowledgeVersionIdSchema validates a correct id", () => {
    const id = newKnowledgeVersionId();
    expect(knowledgeVersionIdSchema.safeParse(id).success).toBe(true);
  });

  it("knowledgeVersionIdSchema rejects garbage", () => {
    expect(knowledgeVersionIdSchema.safeParse("bad").success).toBe(false);
  });
});
