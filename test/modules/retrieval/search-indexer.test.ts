import { describe, it, expect } from "vitest";
import { SearchIndexer } from "../../../src/modules/retrieval/search-indexer.js";
import { createFakeDb } from "../../support/fake-db.js";
import { newKnowledgeItemId } from "../../../src/modules/knowledge-core/entities.js";
import type { KnowledgeItem } from "../../../src/modules/knowledge-core/entities.js";

const orgId = "org_1";
const projectId = "proj_1";

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: newKnowledgeItemId(),
    organizationId: orgId,
    projectId,
    type: "Architecture",
    title: "API layer",
    summary: "handles REST requests",
    content: { component: "api", description: "Fastify routes" },
    status: "PUBLISHED",
    version: 1,
    ownerId: "tok_1",
    createdAt: "",
    updatedAt: "",
    lastVerifiedAt: null,
    sourceIds: [],
    embedding: null,
    embeddingModel: null,
    embeddingUpdatedAt: null,
    ...overrides,
  };
}

describe("SearchIndexer", () => {
  it("upsert makes item searchable", async () => {
    const { db } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    const item = makeItem();
    await indexer.upsert(item);
    const results = await indexer.search(orgId, projectId, "Fastify");
    expect(results).toHaveLength(1);
    expect(results[0].knowledgeId).toBe(item.id);
  });

  it("search is case-insensitive", async () => {
    const { db } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    await indexer.upsert(makeItem());
    expect(await indexer.search(orgId, projectId, "fastify")).toHaveLength(1);
  });

  it("remove makes item non-searchable", async () => {
    const { db } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    const item = makeItem();
    await indexer.upsert(item);
    await indexer.remove(orgId, item.id);
    expect(await indexer.search(orgId, projectId, "Fastify")).toHaveLength(0);
  });

  it("upsert on update replaces existing record", async () => {
    const { db, rows } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    const item = makeItem();
    await indexer.upsert(item);
    await indexer.upsert({ ...item, title: "Updated API layer" });
    expect(rows.search_records).toHaveLength(1);
    const rec = rows.search_records[0] as { searchText: string };
    expect(rec.searchText).toContain("Updated API layer");
  });

  it("rebuild is idempotent", async () => {
    const { db, rows } = createFakeDb({ search_records: [] });
    const indexer = new SearchIndexer(db);
    const items = [makeItem(), makeItem()];
    await indexer.rebuild(orgId, projectId, items);
    await indexer.rebuild(orgId, projectId, items);
    expect(rows.search_records).toHaveLength(2);
  });
});
