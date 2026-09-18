import { describe, expect, it } from "vitest";
import { createKnowledgeItemStore } from "../../../src/modules/knowledge-core/repository.js";
import { createFakeDb } from "../../support/fake-db.js";

const org = "org_A";
const otherOrg = "org_B";
const project = "proj_1";
const otherProject = "proj_2";

const input = {
  organizationId: org,
  projectId: project,
  type: "Decision" as const,
  title: "Use AuditLog v2",
  summary: "Matter History uses the standardized audit schema.",
  content: {},
  status: "DISCOVERED" as const,
  ownerId: "tok_1",
};

describe("createKnowledgeItemStore.create", () => {
  it("stamps id, version, timestamps and returns the item", async () => {
    const { db } = createFakeDb();
    const item = await createKnowledgeItemStore(db).create(input);
    expect(item).not.toHaveProperty("_id");
    expect(item.id).toMatch(/^know_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(item.organizationId).toBe(org);
    expect(item.projectId).toBe(project);
    expect(item.status).toBe("DISCOVERED");
    expect(item.version).toBe(1);
    expect(item.ownerId).toBe("tok_1");
    expect(item.lastVerifiedAt).toBeNull();
  });
});

describe("createKnowledgeItemStore reads", () => {
  it("findById is organization-scoped", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeItemStore(db);
    const created = await store.create(input);
    expect(await store.findById(org, created.id)).toEqual(created);
    expect(await store.findById(otherOrg, created.id)).toBeNull();
  });

  it("findByProject filters by project, type and status without crossing orgs", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeItemStore(db);
    await store.create(input);
    await store.create({ ...input, projectId: otherProject, type: "Concept", status: "PROPOSED" });

    expect((await store.findByProject(org, { projectId: project })).length).toBe(1);
    expect((await store.findByProject(org, { type: "Concept" })).length).toBe(1);
    expect((await store.findByProject(org, { status: "PROPOSED" })).length).toBe(1);
    expect((await store.findByProject(org, {})).length).toBe(2);
    expect((await store.findByProject(otherOrg, {})).length).toBe(0);
  });
});

describe("createKnowledgeItemStore writes", () => {
  it("updates an in-org item and refuses a foreign one", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeItemStore(db);
    const created = await store.create(input);

    const updated = await store.update(org, created.id, { title: "New title" });
    expect(updated?.title).toBe("New title");
    expect(updated?.id).toBe(created.id);
    expect(updated?.updatedAt).not.toBe("");

    expect(await store.update(otherOrg, created.id, { title: "Evil" })).toBeNull();
  });

  it("deletes only an in-org item and reports whether it removed one", async () => {
    const { db, rows } = createFakeDb();
    const store = createKnowledgeItemStore(db);
    const created = await store.create(input);

    expect(await store.delete(otherOrg, created.id)).toBe(false);
    expect(rows.knowledge_items).toHaveLength(1);

    expect(await store.delete(org, created.id)).toBe(true);
    expect(rows.knowledge_items).toHaveLength(0);
    expect(await store.findById(org, created.id)).toBeNull();
  });
});
