import { describe, expect, it } from "vitest";
import { createRelationStore } from "../../../src/modules/knowledge-core/relation-repository.js";
import { createFakeDb } from "../../support/fake-db.js";

const org = "org_A";
function store() {
  const { db } = createFakeDb({ relations: [] });
  return createRelationStore(db);
}
const base = {
  organizationId: org, projectId: "prj_1", subjectId: "a",
  predicate: "depends_on" as const, objectId: "b", status: "PROPOSED" as const, ownerId: "tok_1",
};

describe("relation-repository", () => {
  it("creates at version 1 with empty sourceIds and null reviewerId", async () => {
    const s = store();
    const rel = await s.create(base);
    expect(rel.id).toMatch(/^rel_/);
    expect(rel.version).toBe(1);
    expect(rel.sourceIds).toEqual([]);
    expect(rel.reviewerId).toBeNull();
  });

  it("finds by id within the tenant only", async () => {
    const s = store();
    const rel = await s.create(base);
    expect(await s.findById(org, rel.id)).not.toBeNull();
    expect(await s.findById("org_other", rel.id)).toBeNull();
  });

  it("filters by predicate and status", async () => {
    const s = store();
    await s.create(base);
    await s.create({ ...base, predicate: "fixes" });
    const depends = await s.findByProject(org, { projectId: "prj_1", predicate: "depends_on" });
    expect(depends).toHaveLength(1);
    expect(depends[0].predicate).toBe("depends_on");
  });

  it("update bumps version and can stamp reviewerId", async () => {
    const s = store();
    const rel = await s.create(base);
    const updated = await s.update(org, rel.id, { status: "ACCEPTED", reviewerId: "tok_2" });
    expect(updated?.version).toBe(2);
    expect(updated?.status).toBe("ACCEPTED");
    expect(updated?.reviewerId).toBe("tok_2");
  });

  it("setSourceIds replaces the array and bumps version", async () => {
    const s = store();
    const rel = await s.create(base);
    const updated = await s.setSourceIds(org, rel.id, ["src_1"]);
    expect(updated?.sourceIds).toEqual(["src_1"]);
    expect(updated?.version).toBe(2);
  });

  it("delete returns true then false", async () => {
    const s = store();
    const rel = await s.create(base);
    expect(await s.delete(org, rel.id)).toBe(true);
    expect(await s.delete(org, rel.id)).toBe(false);
  });
});
