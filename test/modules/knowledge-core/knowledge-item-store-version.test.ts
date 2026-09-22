import { describe, expect, it } from "vitest";
import { createKnowledgeItemStore } from "../../../src/modules/knowledge-core/repository.js";
import { createFakeDb, type Row } from "../../support/fake-db.js";
import type { KnowledgeItem } from "../../../src/modules/knowledge-core/entities.js";

const orgId = "org_A";

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: "know_ITEM01",
    organizationId: orgId,
    projectId: "proj_A",
    type: "Fact",
    title: "t",
    summary: "s",
    content: { subject: "x", predicate: "is" },
    status: "PUBLISHED",
    version: 1,
    ownerId: "tok_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: null,
    sourceIds: [],
    ...overrides,
  };
}

describe("KnowledgeItemStore.update version increment", () => {
  it("increments version atomically on update", async () => {
    const { db } = createFakeDb({ knowledge_items: [makeItem() as unknown as Row] });
    const store = createKnowledgeItemStore(db);
    const updated = await store.update(orgId, "know_ITEM01", { title: "new title" });
    expect(updated?.version).toBe(2);
  });

  it("version reaches 4 after three updates", async () => {
    const { db } = createFakeDb({ knowledge_items: [makeItem() as unknown as Row] });
    const store = createKnowledgeItemStore(db);
    await store.update(orgId, "know_ITEM01", { title: "a" });
    await store.update(orgId, "know_ITEM01", { title: "b" });
    const final = await store.update(orgId, "know_ITEM01", { title: "c" });
    expect(final?.version).toBe(4);
  });
});
