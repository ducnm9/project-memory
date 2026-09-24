import { describe, it, expect } from "vitest";
import type { AppConfig } from "../../../src/config/index.js";
import { createFakeDb } from "../../support/fake-db.js";
import { searchKnowledge } from "../../../src/modules/mcp/tools/search.js";
import { analyzeImpact } from "../../../src/modules/mcp/tools/impact.js";

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
