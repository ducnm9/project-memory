import { describe, expect, it } from "vitest";
import {
  createSourceBodySchema,
  newSourceId,
  sourceIdSchema,
  sourceTypeSchema,
} from "../../../src/modules/knowledge-core/source-entities.js";
import { newProjectId } from "../../../src/modules/project-context/entities.js";

describe("source-entities", () => {
  const projectId = newProjectId();

  it("newSourceId returns a src_-prefixed ULID that matches the id schema", () => {
    const id = newSourceId();
    expect(id).toMatch(/^src_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(sourceIdSchema.safeParse(id).success).toBe(true);
  });

  it("sourceIdSchema rejects a wrong prefix and wrong length", () => {
    expect(sourceIdSchema.safeParse("know_0000000000000000000000000").success).toBe(false);
    expect(sourceIdSchema.safeParse("src_short").success).toBe(false);
  });

  it("sourceTypeSchema accepts a known type and rejects an unknown one", () => {
    expect(sourceTypeSchema.safeParse("git_commit").success).toBe(true);
    expect(sourceTypeSchema.safeParse("carrier_pigeon").success).toBe(false);
  });

  it("createSourceBodySchema requires a non-empty locator", () => {
    const base = { projectId, type: "document", metadata: {} };
    expect(createSourceBodySchema.safeParse({ ...base, locator: "" }).success).toBe(false);
    expect(createSourceBodySchema.safeParse({ ...base, locator: "   " }).success).toBe(false);
    expect(createSourceBodySchema.safeParse({ ...base, locator: "https://x" }).success).toBe(true);
  });

  it("createSourceBodySchema defaults metadata to {} and rejects unknown fields", () => {
    const parsed = createSourceBodySchema.safeParse({
      projectId,
      type: "human_input",
      locator: "note from standup",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.metadata).toEqual({});

    const extra = createSourceBodySchema.safeParse({
      projectId,
      type: "human_input",
      locator: "x",
      surprise: 1,
    });
    expect(extra.success).toBe(false);
  });
});
