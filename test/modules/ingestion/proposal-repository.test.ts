import { describe, it, expect } from "vitest";
import { createProposalStore } from "../../../src/modules/ingestion/proposal-repository.js";
import { createFakeDb } from "../../support/fake-db.js";

describe("ProposalStore", () => {
  it("creates a proposal in PROPOSED status", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1",
      type: "Architecture", title: "Overview", summary: "Main app",
      content: {}, sourceIds: [], triggeredBy: "bootstrap",
    });
    expect(p.id).toMatch(/^prop_/);
    expect(p.status).toBe("PROPOSED");
    expect(p.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("existsByHash returns false for unknown hash", async () => {
    const { db } = createFakeDb();
    expect(await createProposalStore(db).existsByHash("org_1", "proj_1", "abc")).toBe(false);
  });

  it("existsByHash returns true after creation", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1",
      type: "Decision", title: "Use MongoDB", summary: "NoSQL choice",
      content: {}, sourceIds: [], triggeredBy: "bootstrap",
    });
    expect(await store.existsByHash("org_1", "proj_1", p.contentHash)).toBe(true);
  });

  it("findByProject lists all proposals for a project", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    await store.create({ organizationId: "org_1", projectId: "proj_1", type: "Concept", title: "CI", summary: "Uses GH Actions", content: {}, sourceIds: [], triggeredBy: "bootstrap" });
    await store.create({ organizationId: "org_1", projectId: "proj_1", type: "Concept", title: "Build", summary: "Uses npm", content: {}, sourceIds: [], triggeredBy: "bootstrap" });
    const list = await store.findByProject("org_1", "proj_1");
    expect(list).toHaveLength(2);
  });

  it("approve transitions status and sets knowledgeItemId", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const p = await store.create({ organizationId: "org_1", projectId: "proj_1", type: "Concept", title: "Auth", summary: "Auth module", content: {}, sourceIds: [], triggeredBy: "bootstrap" });
    const approved = await store.approve("org_1", p.id, "actor_1", "know_abc");
    expect(approved!.status).toBe("APPROVED");
    expect(approved!.knowledgeItemId).toBe("know_abc");
    expect(approved!.reviewedBy).toBe("actor_1");
  });

  it("reject transitions status", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const p = await store.create({ organizationId: "org_1", projectId: "proj_1", type: "Concept", title: "t", summary: "s", content: {}, sourceIds: [], triggeredBy: "bootstrap" });
    const rejected = await store.reject("org_1", p.id, "actor_1");
    expect(rejected!.status).toBe("REJECTED");
  });
});
