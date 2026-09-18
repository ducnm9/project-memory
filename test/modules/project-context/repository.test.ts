import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createRepository } from "../../../src/modules/project-context/repository.js";

function mockDb(handlers: Record<string, unknown>) {
  const collection = vi.fn((name: string) => handlers[name]);
  return { db: { collection } as unknown as Db, collection };
}

describe("createOrganization", () => {
  it("inserts and returns an org with a generated id and timestamps", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const { db } = mockDb({ organizations: { insertOne } });
    const repo = createRepository(db);
    const org = await repo.createOrganization("Acme");
    expect(org.name).toBe("Acme");
    expect(org.id).toMatch(/^org_/);
    expect(org.createdAt).toBe(org.updatedAt);
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ id: org.id, name: "Acme" }));
  });
});

describe("getProject org-ownership", () => {
  it("returns null when the project belongs to a different org", async () => {
    const findOne = vi.fn().mockResolvedValue(null); // filter includes organizationId, so mismatch = no doc
    const { db } = mockDb({ projects: { findOne } });
    const repo = createRepository(db);
    const result = await repo.getProject("org_A", "proj_X");
    expect(result).toBeNull();
    expect(findOne).toHaveBeenCalledWith(
      { id: "proj_X", organizationId: "org_A" },
      { projection: { _id: 0 } },
    );
  });
});

describe("listProjects", () => {
  it("queries by organizationId and returns the array", async () => {
    const toArray = vi.fn().mockResolvedValue([{ id: "proj_1", organizationId: "org_A", name: "p" }]);
    const find = vi.fn().mockReturnValue({ toArray });
    const { db } = mockDb({ projects: { find } });
    const repo = createRepository(db);
    const rows = await repo.listProjects("org_A");
    expect(find).toHaveBeenCalledWith({ organizationId: "org_A" }, { projection: { _id: 0 } });
    expect(rows).toHaveLength(1);
  });
});
