import { describe, it, expect } from "vitest";
import type { AppConfig } from "../../../src/config/index.js";
import { createFakeDb } from "../../support/fake-db.js";
import { searchKnowledge } from "../../../src/modules/mcp/tools/search.js";
import { analyzeImpact } from "../../../src/modules/mcp/tools/impact.js";
import { proposeKnowledge } from "../../../src/modules/mcp/tools/propose.js";

const stubConfig = { embedding: null, llm: null } as unknown as AppConfig;

describe("MCP searchKnowledge tool", () => {
  it("returns empty results for empty index", async () => {
    const { db } = createFakeDb({ search_records: [], knowledge_items: [] });
    const result = await searchKnowledge(
      { query: "database schema" },
      db,
      stubConfig,
    );
    expect(result).toHaveProperty("results");
    expect(Array.isArray((result as Record<string, unknown>).results)).toBe(true);
  });

  it("throws for missing query", async () => {
    const { db } = createFakeDb({});
    await expect(searchKnowledge({}, db, stubConfig)).rejects.toThrow();
  });
});

describe("MCP analyzeImpact tool", () => {
  it("returns empty impacts for unknown item", async () => {
    const { db } = createFakeDb({ knowledge_items: [], relations: [] });
    const result = await analyzeImpact(
      { componentId: "know_01AAAAAAAAAAAAAAAAAAAAAAAAA", projectId: "proj_1" },
      db,
      stubConfig,
    );
    expect(result).toHaveProperty("impacts");
  });
});

describe("MCP proposeKnowledge tool", () => {
  it("throws for missing orgId", async () => {
    const { db } = createFakeDb({});
    await expect(
      proposeKnowledge({ type: "Decision", title: "T", content: {}, projectId: "proj_1" }, db, stubConfig),
    ).rejects.toThrow("required");
  });

  it("throws for non-object content", async () => {
    const { db } = createFakeDb({});
    await expect(
      proposeKnowledge({ type: "Decision", title: "T", content: "a string", orgId: "org_1", projectId: "proj_1" }, db, stubConfig),
    ).rejects.toThrow("object");
  });
});
