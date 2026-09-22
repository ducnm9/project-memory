import { describe, expect, it } from "vitest";
import { createFactVersionStore } from "../../../src/modules/knowledge-core/fact-version-repository.js";
import { newFactVersionId, factVersionIdSchema } from "../../../src/modules/knowledge-core/fact-version-entities.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { Fact } from "../../../src/modules/knowledge-core/fact-entities.js";

const orgId = "org_1";
const snapshot = (version: number): Fact => ({
  id: "fact_00000000000000000000000000",
  organizationId: orgId,
  projectId: "proj_1",
  subjectId: "s",
  predicate: "p",
  objectId: "o",
  status: "PROPOSED",
  version,
  ownerId: "tok_1",
  sourceIds: [],
  createdAt: "t",
  updatedAt: "t",
  lastVerifiedAt: null,
});

describe("factVersionIdSchema", () => {
  it("accepts a generated id", () => {
    expect(factVersionIdSchema.safeParse(newFactVersionId()).success).toBe(true);
  });
});

describe("FactVersionStore", () => {
  it("appends and lists versions in ascending order", async () => {
    const { db } = createFakeDb({ fact_versions: [] });
    const store = createFactVersionStore(db);
    await store.append({ organizationId: orgId, factId: "fact_x", version: 1, snapshot: snapshot(1), changedBy: "tok_1", changeSummary: "initial version" });
    await store.append({ organizationId: orgId, factId: "fact_x", version: 2, snapshot: snapshot(2), changedBy: "tok_1", changeSummary: "second" });
    const list = await store.listByFact(orgId, "fact_x");
    expect(list.map((v) => v.version)).toEqual([1, 2]);
  });

  it("finds a specific version scoped to the org", async () => {
    const { db } = createFakeDb({ fact_versions: [] });
    const store = createFactVersionStore(db);
    await store.append({ organizationId: orgId, factId: "fact_x", version: 1, snapshot: snapshot(1), changedBy: "tok_1", changeSummary: "initial version" });
    expect(await store.findByVersion(orgId, "fact_x", 1)).toMatchObject({ version: 1 });
    expect(await store.findByVersion(orgId, "fact_x", 9)).toBeNull();
  });
});
