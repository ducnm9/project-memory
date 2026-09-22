import { describe, expect, it } from "vitest";
import { createFactStore } from "../../../src/modules/knowledge-core/fact-repository.js";
import { createFakeDb } from "../../support/fake-db.js";

const orgId = "org_1";
const base = {
  organizationId: orgId,
  projectId: "proj_1",
  subjectId: "matter-history",
  predicate: "depends_on",
  objectId: "audit-log",
  status: "PROPOSED" as const,
  ownerId: "tok_1",
};

describe("FactStore", () => {
  it("creates a fact at version 1 with empty sourceIds", async () => {
    const { db } = createFakeDb({ facts: [] });
    const store = createFactStore(db);
    const fact = await store.create(base);
    expect(fact.id).toMatch(/^fact_/);
    expect(fact.version).toBe(1);
    expect(fact.sourceIds).toEqual([]);
    expect(fact.status).toBe("PROPOSED");
    expect(fact.lastVerifiedAt).toBeNull();
  });

  it("finds by id scoped to the org", async () => {
    const { db } = createFakeDb({ facts: [] });
    const store = createFactStore(db);
    const created = await store.create(base);
    expect(await store.findById(orgId, created.id)).toMatchObject({ id: created.id });
    expect(await store.findById("org_other", created.id)).toBeNull();
  });

  it("filters by predicate and status", async () => {
    const { db } = createFakeDb({ facts: [] });
    const store = createFactStore(db);
    await store.create(base);
    await store.create({ ...base, predicate: "impacts" });
    const byPred = await store.findByProject(orgId, { predicate: "impacts" });
    expect(byPred).toHaveLength(1);
    const byStatus = await store.findByProject(orgId, { status: "PROPOSED" });
    expect(byStatus).toHaveLength(2);
  });

  it("updates fields and bumps version", async () => {
    const { db } = createFakeDb({ facts: [] });
    const store = createFactStore(db);
    const created = await store.create(base);
    const updated = await store.update(orgId, created.id, { status: "ACCEPTED" });
    expect(updated?.status).toBe("ACCEPTED");
    expect(updated?.version).toBe(2);
  });

  it("sets sourceIds and bumps version", async () => {
    const { db } = createFakeDb({ facts: [] });
    const store = createFactStore(db);
    const created = await store.create(base);
    const updated = await store.setSourceIds(orgId, created.id, ["src_1"]);
    expect(updated?.sourceIds).toEqual(["src_1"]);
    expect(updated?.version).toBe(2);
  });

  it("deletes scoped to the org", async () => {
    const { db } = createFakeDb({ facts: [] });
    const store = createFactStore(db);
    const created = await store.create(base);
    expect(await store.delete("org_other", created.id)).toBe(false);
    expect(await store.delete(orgId, created.id)).toBe(true);
  });
});
