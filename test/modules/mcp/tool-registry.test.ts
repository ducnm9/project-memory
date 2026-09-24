import { describe, it, expect } from "vitest";
import { loadToolRegistry } from "../../../src/modules/mcp/tool-registry.js";

describe("ToolRegistry", () => {
  it("loads all three tool schemas from specs/mcp/tools/", async () => {
    const registry = await loadToolRegistry();
    const names = registry.map(t => t.name);
    expect(names).toContain("knowledge.search");
    expect(names).toContain("knowledge.propose");
    expect(names).toContain("knowledge.impact");
  });

  it("each tool has a name and inputSchema", async () => {
    const registry = await loadToolRegistry();
    for (const tool of registry) {
      expect(tool.name).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});
