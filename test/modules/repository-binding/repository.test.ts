import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createRepositoryStore } from "../../../src/modules/repository-binding/repository.js";

const base = {
  organizationId: "org_A",
  projectId: "proj_P",
  url: "https://github.com/acme/widgets",
  host: "github.com",
  path: "acme/widgets",
  connector: "github" as const,
  defaultBranch: null,
  createdBy: "tok_1",
};

function mockDb(handlers: Record<string, unknown>) {
  const collection = vi.fn((name: string) => handlers[name]);
  return { db: { collection } as unknown as Db, collection };
}

describe("createRepository", () => {
  it("inserts a binding with a generated id, timestamps, and null unboundAt", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const { db } = mockDb({ repositories: { insertOne } });
    const store = createRepositoryStore(db);
    const repository = await store.createRepository(base);
    expect(repository.id).toMatch(/^repo_/);
    expect(repository.unboundAt).toBeNull();
    expect(repository.createdAt).toBeTruthy();
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: repository.id, ...base, unboundAt: null }),
    );
  });
});

describe("findActiveByUrl", () => {
  it("queries the active binding for the org and canonical url", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const { db } = mockDb({ repositories: { findOne } });
    await createRepositoryStore(db).findActiveByUrl("org_A", "https://github.com/acme/widgets");
    expect(findOne).toHaveBeenCalledWith(
      { organizationId: "org_A", url: "https://github.com/acme/widgets", unboundAt: null },
      { projection: { _id: 0 } },
    );
  });
});

describe("listActiveByProject", () => {
  it("queries active bindings for the org and project", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const { db } = mockDb({ repositories: { find } });
    await createRepositoryStore(db).listActiveByProject("org_A", "proj_P");
    expect(find).toHaveBeenCalledWith(
      { organizationId: "org_A", projectId: "proj_P", unboundAt: null },
      { projection: { _id: 0 } },
    );
  });
});

describe("markUnbound", () => {
  it("returns true when an active binding was unbound", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const { db } = mockDb({ repositories: { updateOne } });
    await expect(createRepositoryStore(db).markUnbound("org_A", "proj_P", "repo_1"))
      .resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { id: "repo_1", organizationId: "org_A", projectId: "proj_P", unboundAt: null },
      { $set: { unboundAt: expect.any(String) } },
    );
  });

  it("returns false when no active binding matched", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const { db } = mockDb({ repositories: { updateOne } });
    await expect(createRepositoryStore(db).markUnbound("org_A", "proj_P", "repo_1"))
      .resolves.toBe(false);
  });
});
