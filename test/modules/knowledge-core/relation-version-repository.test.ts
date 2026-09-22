import { describe, expect, it } from "vitest";
import { createRelationVersionStore } from "../../../src/modules/knowledge-core/relation-version-repository.js";
import { relationVersionIdSchema, newRelationVersionId } from "../../../src/modules/knowledge-core/relation-version-entities.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { Relation } from "../../../src/modules/knowledge-core/relation-entities.js";

const org = "org_A";
const snapshot = (version: number): Relation => ({
  id: "rel_x", organizationId: org, projectId: "prj_1", subjectId: "a",
  predicate: "depends_on", objectId: "b", status: "PROPOSED", version,
  ownerId: "tok_1", reviewerId: null, sourceIds: [], createdAt: "", updatedAt: "", lastVerifiedAt: null,
});
function store() {
  const { db } = createFakeDb({ relation_versions: [] });
  return createRelationVersionStore(db);
}

describe("relation-version-repository", () => {
  it("mints version ids matching the schema", () => {
    expect(relationVersionIdSchema.safeParse(newRelationVersionId()).success).toBe(true);
  });

  it("appends and lists by relation in version order", async () => {
    const s = store();
    await s.append({ organizationId: org, relationId: "rel_x", version: 2, snapshot: snapshot(2), changedBy: "tok_1", changeSummary: "second" });
    await s.append({ organizationId: org, relationId: "rel_x", version: 1, snapshot: snapshot(1), changedBy: "tok_1", changeSummary: "initial version" });
    const list = await s.listByRelation(org, "rel_x");
    expect(list.map((v) => v.version)).toEqual([1, 2]);
  });

  it("finds a specific version", async () => {
    const s = store();
    await s.append({ organizationId: org, relationId: "rel_x", version: 1, snapshot: snapshot(1), changedBy: "tok_1", changeSummary: "initial version" });
    const v = await s.findByVersion(org, "rel_x", 1);
    expect(v?.snapshot.version).toBe(1);
    expect(await s.findByVersion(org, "rel_x", 99)).toBeNull();
  });
});
