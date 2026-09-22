import { describe, expect, it } from "vitest";
import { createKnowledgeVersionStore } from "../../../src/modules/knowledge-core/version-repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { KnowledgeItem } from "../../../src/modules/knowledge-core/entities.js";

const orgId = "org_A";

function makeSnapshot(version: number): KnowledgeItem {
  return {
    id: "know_TEST",
    organizationId: orgId,
    projectId: "proj_A",
    type: "Concept",
    title: "t",
    summary: "s",
    content: { subject: "x", predicate: "is" },
    status: "PUBLISHED",
    version,
    ownerId: "tok_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: null,
    sourceIds: [],
  };
}

describe("KnowledgeVersionStore", () => {
  it("appends a version and returns it with a kver_ id", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    const v = await store.append({
      organizationId: orgId,
      knowledgeId: "know_TEST",
      version: 1,
      snapshot: makeSnapshot(1),
      changedBy: "tok_1",
      changeSummary: "initial version",
    });
    expect(v.id).toMatch(/^kver_/);
    expect(v.version).toBe(1);
    expect(v.changeSummary).toBe("initial version");
    expect(v.snapshot.version).toBe(1);
  });

  it("listByKnowledge returns versions sorted ascending", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 2, snapshot: makeSnapshot(2), changedBy: "tok_1", changeSummary: "c2" });
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 1, snapshot: makeSnapshot(1), changedBy: "tok_1", changeSummary: "c1" });
    const list = await store.listByKnowledge(orgId, "know_TEST");
    expect(list.map((v) => v.version)).toEqual([1, 2]);
  });

  it("listByKnowledge is tenant-scoped", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 1, snapshot: makeSnapshot(1), changedBy: "tok_1", changeSummary: "c" });
    const list = await store.listByKnowledge("org_OTHER", "know_TEST");
    expect(list).toHaveLength(0);
  });

  it("findByVersion returns the correct snapshot", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 1, snapshot: makeSnapshot(1), changedBy: "tok_1", changeSummary: "c" });
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 2, snapshot: makeSnapshot(2), changedBy: "tok_1", changeSummary: "c2" });
    const v = await store.findByVersion(orgId, "know_TEST", 1);
    expect(v?.version).toBe(1);
    expect(v?.snapshot.version).toBe(1);
  });

  it("findByVersion returns null for missing version", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    const v = await store.findByVersion(orgId, "know_TEST", 99);
    expect(v).toBeNull();
  });
});
