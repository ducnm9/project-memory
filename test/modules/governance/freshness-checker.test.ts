import { describe, it, expect } from "vitest";
import { createFakeDb, type Row } from "../../support/fake-db.js";
import { FreshnessChecker } from "../../../src/modules/governance/freshness-checker.js";
import type { KnowledgeItem } from "../../../src/modules/knowledge-core/entities.js";

function makeItem(overrides: Partial<KnowledgeItem> = {}): Row {
  return {
    id: "know_01", organizationId: "org_1", projectId: "proj_1",
    type: "Procedure", title: "T", summary: "S", content: {},
    status: "PUBLISHED", version: 1, ownerId: "tok_1",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    sourceIds: [], embedding: null, embeddingModel: null, embeddingUpdatedAt: null,
    contentHash: "abc",
    ...overrides,
  } as Row;
}

describe("FreshnessChecker", () => {
  it("marks STALE when TTL expired", async () => {
    const { db, rows } = createFakeDb({
      knowledge_items: [makeItem({ lastVerifiedAt: "2020-01-01T00:00:00.000Z" })],
      audit_events: [],
    });
    const checker = new FreshnessChecker(db);
    const result = await checker.check("org_1", "proj_1", { ttlDays: { Procedure: 30 } });
    expect(result.marked).toBe(1);
    expect(rows.knowledge_items[0].status).toBe("STALE");
  });

  it("does not re-mark already STALE items", async () => {
    const { db } = createFakeDb({
      knowledge_items: [makeItem({ status: "STALE", lastVerifiedAt: "2020-01-01T00:00:00.000Z" })],
      audit_events: [],
    });
    const checker = new FreshnessChecker(db);
    const result = await checker.check("org_1", "proj_1", { ttlDays: { Procedure: 30 } });
    expect(result.marked).toBe(0);
  });

  it("leaves fresh items alone", async () => {
    const { db, rows } = createFakeDb({
      knowledge_items: [makeItem({ lastVerifiedAt: new Date().toISOString() })],
      audit_events: [],
    });
    const checker = new FreshnessChecker(db);
    const result = await checker.check("org_1", "proj_1", { ttlDays: { Procedure: 30 } });
    expect(result.marked).toBe(0);
    expect(rows.knowledge_items[0].status).toBe("PUBLISHED");
  });
});
