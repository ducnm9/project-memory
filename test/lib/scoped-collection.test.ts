import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { scopedCollection } from "../../src/lib/scoped-collection.js";

function mockCollection() {
  const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
  const findOne = vi.fn().mockResolvedValue(null);
  const insertOne = vi.fn().mockResolvedValue({});
  const db = { collection: vi.fn().mockReturnValue({ find, findOne, insertOne }) } as unknown as Db;
  return { db, find, findOne, insertOne };
}

const projectCtx = { organizationId: "org_A", projectId: "proj_1" };
const sharedCtx = { organizationId: "org_A", projectId: null };

describe("scopedCollection reads", () => {
  it("injects org + project|null predicate on find", () => {
    const { db, find } = mockCollection();
    scopedCollection(db, "knowledge_items", projectCtx).find({ type: "Decision" });
    expect(find).toHaveBeenCalledWith({
      type: "Decision",
      organizationId: "org_A",
      projectId: { $in: ["proj_1", null] },
    });
  });

  it("at org-shared scope the predicate is projectId null only", () => {
    const { db, find } = mockCollection();
    scopedCollection(db, "knowledge_items", sharedCtx).find();
    expect(find).toHaveBeenCalledWith({
      organizationId: "org_A",
      projectId: { $in: [null] },
    });
  });
});

describe("scopedCollection writes", () => {
  it("stamps the exact scope, overriding any caller-supplied scope", async () => {
    const { db, insertOne } = mockCollection();
    await scopedCollection(db, "knowledge_items", projectCtx).insertOne({
      title: "x",
      organizationId: "org_EVIL",
      projectId: "proj_EVIL",
    });
    expect(insertOne).toHaveBeenCalledWith({
      title: "x",
      organizationId: "org_A",
      projectId: "proj_1",
    });
  });
});
