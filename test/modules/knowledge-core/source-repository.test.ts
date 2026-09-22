import { describe, expect, it } from "vitest";
import { createSourceStore } from "../../../src/modules/knowledge-core/source-repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import { newProjectId } from "../../../src/modules/project-context/entities.js";

const orgA = "org_A";
const orgB = "org_B";
const projectId = newProjectId();

function store() {
  const { db, rows } = createFakeDb({ sources: [] });
  return { store: createSourceStore(db), rows };
}

const input = {
  organizationId: orgA,
  projectId,
  type: "git_commit" as const,
  locator: "abc123",
  metadata: { sha: "abc123" },
  createdBy: "tok_1",
};

describe("SourceStore", () => {
  it("create assigns an src_ id and createdAt, preserving fields", async () => {
    const { store: s } = store();
    const created = await s.create(input);
    expect(created.id).toMatch(/^src_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(created.createdAt).not.toBe("");
    expect(created.locator).toBe("abc123");
    expect(created.metadata).toEqual({ sha: "abc123" });
    expect(created.createdBy).toBe("tok_1");
  });

  it("findById is org-scoped", async () => {
    const { store: s } = store();
    const created = await s.create(input);
    expect(await s.findById(orgA, created.id)).not.toBeNull();
    expect(await s.findById(orgB, created.id)).toBeNull();
  });

  it("findByProject filters by projectId and type", async () => {
    const { store: s } = store();
    await s.create(input);
    await s.create({ ...input, type: "document", locator: "doc-1" });
    const byProject = await s.findByProject(orgA, { projectId });
    expect(byProject).toHaveLength(2);
    const byType = await s.findByProject(orgA, { projectId, type: "document" });
    expect(byType).toHaveLength(1);
    expect(byType[0].type).toBe("document");
  });

  it("delete returns true when removed and false when absent", async () => {
    const { store: s } = store();
    const created = await s.create(input);
    expect(await s.delete(orgA, created.id)).toBe(true);
    expect(await s.delete(orgA, created.id)).toBe(false);
  });
});
