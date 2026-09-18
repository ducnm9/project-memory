import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { CORE_INDEXES, ROOT_INDEXES, ensureIndexes } from "../../src/lib/indexes.js";

const EXPECTED_COLLECTIONS = [
  "knowledge_items",
  "facts",
  "relations",
  "sources",
  "versions",
  "proposals",
  "audit_events",
  "knowledge_gaps",
];

describe("CORE_INDEXES", () => {
  it("covers every core collection with the org_project tenancy index", () => {
    const names = CORE_INDEXES.map((e) => e.collection);
    expect(names.sort()).toEqual([...EXPECTED_COLLECTIONS].sort());
    for (const entry of CORE_INDEXES) {
      const tenancy = entry.indexes.find((i) => i.name === "org_project");
      expect(tenancy, `${entry.collection} missing org_project`).toBeDefined();
      expect(tenancy?.key).toEqual({ organizationId: 1, projectId: 1 });
    }
  });
});

describe("ensureIndexes", () => {
  it("creates the declared indexes on each collection exactly once", async () => {
    const createIndexes = vi.fn().mockResolvedValue(["org_project"]);
    const collection = vi.fn().mockReturnValue({ createIndexes });
    const db = { collection } as unknown as Db;

    await ensureIndexes(db);

    const total = CORE_INDEXES.length + ROOT_INDEXES.length;
    expect(collection).toHaveBeenCalledTimes(total);
    for (const entry of [...CORE_INDEXES, ...ROOT_INDEXES]) {
      expect(collection).toHaveBeenCalledWith(entry.collection);
    }
    expect(createIndexes).toHaveBeenCalledTimes(total);
  });

  it("propagates a createIndexes failure", async () => {
    const createIndexes = vi.fn().mockRejectedValue(new Error("index build failed"));
    const collection = vi.fn().mockReturnValue({ createIndexes });
    const db = { collection } as unknown as Db;

    await expect(ensureIndexes(db)).rejects.toThrow("index build failed");
  });
});

describe("ROOT_INDEXES", () => {
  it("declares unique id indexes for organizations and projects, plus org lookup", () => {
    const byCol = Object.fromEntries(ROOT_INDEXES.map((e) => [e.collection, e.indexes]));
    expect(byCol.organizations.some((i) => i.name === "id_unique" && i.unique)).toBe(true);
    expect(byCol.projects.some((i) => i.name === "id_unique" && i.unique)).toBe(true);
    expect(byCol.projects.some((i) => i.name === "org_lookup")).toBe(true);
  });
});

describe("service_tokens indexes", () => {
  it("declares unique id, unique hashedSecret, and org lookup", () => {
    const entry = ROOT_INDEXES.find((c) => c.collection === "service_tokens");
    expect(entry).toBeDefined();
    const names = entry!.indexes.map((i) => i.name);
    expect(names).toContain("id_unique");
    expect(names).toContain("hashed_secret_unique");
    expect(names).toContain("org_lookup");
    const hs = entry!.indexes.find((i) => i.name === "hashed_secret_unique");
    expect(hs!.unique).toBe(true);
  });
});
