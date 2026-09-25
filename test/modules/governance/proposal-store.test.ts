import { describe, it, expect } from "vitest";
import { createFakeDb } from "../../support/fake-db.js";
import { createProposalStore } from "../../../src/modules/governance/proposal-store.js";

describe("ProposalStore", () => {
  it("creates a proposal in VALIDATING status", async () => {
    const { db } = createFakeDb({ proposals: [], conflicts: [] });
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1", type: "Decision",
      title: "Use Postgres", summary: "We should use Postgres",
      content: { context: "ctx", problem: "p", decision: "d" },
      sourceIds: [], triggeredBy: "manual", proposedBy: "tok_1",
      knowledgeItemId: null, validationResults: [],
    });
    expect(p.status).toBe("VALIDATING");
    expect(p.id).toMatch(/^prop_/);
  });

  it("existsByHash returns true for duplicate contentHash", async () => {
    const { db } = createFakeDb({ proposals: [], conflicts: [] });
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1", type: "Decision",
      title: "T", summary: "S", content: {}, sourceIds: [],
      triggeredBy: "manual", proposedBy: "tok_1", knowledgeItemId: null,
      validationResults: [],
    });
    const exists = await store.existsByHash("org_1", "proj_1", p.contentHash);
    expect(exists).toBe(true);
  });

  it("approve transitions to PUBLISHED and sets reviewedBy", async () => {
    const { db } = createFakeDb({ proposals: [], conflicts: [] });
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1", type: "Decision",
      title: "T", summary: "S", content: {}, sourceIds: [],
      triggeredBy: "manual", proposedBy: "tok_1", knowledgeItemId: null,
      validationResults: [],
    });
    const approved = await store.approve("org_1", p.id, "tok_reviewer", "know_1");
    expect(approved?.status).toBe("PUBLISHED");
    expect(approved?.reviewedBy).toBe("tok_reviewer");
  });

  it("reject transitions to REJECTED with reason", async () => {
    const { db } = createFakeDb({ proposals: [], conflicts: [] });
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1", type: "Decision",
      title: "T", summary: "S", content: {}, sourceIds: [],
      triggeredBy: "manual", proposedBy: "tok_1", knowledgeItemId: null,
      validationResults: [],
    });
    const rejected = await store.reject("org_1", p.id, "tok_reviewer", "not relevant");
    expect(rejected?.status).toBe("REJECTED");
    expect(rejected?.rejectionReason).toBe("not relevant");
  });
});
