import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { CORE_INDEXES, ROOT_INDEXES, ensureIndexes } from "../../src/lib/indexes.js";
import { SourceNotFoundError } from "../../src/lib/errors.js";

const EXPECTED_COLLECTIONS = [
  "knowledge_items",
  "facts",
  "relations",
  "sources",
  "versions",
  "proposals",
  "audit_events",
  "knowledge_gaps",
  "fact_versions",
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

describe("repositories indexes", () => {
  it("declares unique id, unique active url, and project lookup", () => {
    const entry = ROOT_INDEXES.find((c) => c.collection === "repositories");
    expect(entry).toBeDefined();
    const names = entry!.indexes.map((i) => i.name);
    expect(names).toContain("id_unique");
    expect(names).toContain("active_url_unique");
    expect(names).toContain("project_lookup");

    const activeUrl = entry!.indexes.find((i) => i.name === "active_url_unique");
    expect(activeUrl!.unique).toBe(true);
    expect(activeUrl!.partialFilterExpression).toEqual({ unboundAt: null });
  });
});

describe("knowledge_items indexes", () => {
  it("declares unique id plus type and status lookups on top of tenancy", () => {
    const entry = CORE_INDEXES.find((c) => c.collection === "knowledge_items");
    expect(entry).toBeDefined();
    const names = entry!.indexes.map((i) => i.name);
    expect(names).toContain("org_project");
    expect(names).toContain("id_unique");
    expect(names).toContain("project_type");
    expect(names).toContain("project_status");

    expect(entry!.indexes.find((i) => i.name === "id_unique")!.unique).toBe(true);
    expect(entry!.indexes.find((i) => i.name === "project_type")!.key).toEqual({
      organizationId: 1, projectId: 1, type: 1,
    });
    expect(entry!.indexes.find((i) => i.name === "project_status")!.key).toEqual({
      organizationId: 1, projectId: 1, status: 1,
    });
  });
});

describe("sources indexes and error", () => {
  it("declares id_unique and project_type on the sources collection", () => {
    const sources = CORE_INDEXES.find((c) => c.collection === "sources");
    expect(sources).toBeDefined();
    const names = sources!.indexes.map((i) => i.name);
    expect(names).toContain("org_project"); // shared tenancy index
    expect(names).toContain("id_unique");
    expect(names).toContain("project_type");
    const idUnique = sources!.indexes.find((i) => i.name === "id_unique");
    expect(idUnique?.unique).toBe(true);
  });

  it("SourceNotFoundError is a 404 with code SOURCE_NOT_FOUND", () => {
    const err = new SourceNotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("SOURCE_NOT_FOUND");
  });
});

describe("facts and fact_versions indexes", () => {
  it("declares fact identity, predicate, and status lookups", () => {
    const facts = CORE_INDEXES.find((c) => c.collection === "facts");
    expect(facts).toBeDefined();
    const names = facts!.indexes.map((i) => i.name);
    expect(names).toContain("org_project");
    expect(names).toContain("id_unique");
    expect(names).toContain("project_predicate");
    expect(names).toContain("project_status");
    expect(facts!.indexes.find((i) => i.name === "id_unique")!.unique).toBe(true);
    expect(facts!.indexes.find((i) => i.name === "project_predicate")!.key).toEqual({
      organizationId: 1, projectId: 1, predicate: 1,
    });
  });

  it("declares fact_versions identity and fact lookup", () => {
    const fv = CORE_INDEXES.find((c) => c.collection === "fact_versions");
    expect(fv).toBeDefined();
    const names = fv!.indexes.map((i) => i.name);
    expect(names).toContain("org_project");
    expect(names).toContain("id_unique");
    expect(names).toContain("fact_lookup");
    expect(fv!.indexes.find((i) => i.name === "fact_lookup")!.key).toEqual({
      organizationId: 1, factId: 1,
    });
  });
});
