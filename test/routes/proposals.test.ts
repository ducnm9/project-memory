import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect } from "vitest";
import { registerProposalRoutes } from "../../src/routes/proposals.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";
import { newProposalId } from "../../src/modules/ingestion/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";
import type { AppConfig } from "../../src/config/index.js";
import type { Actor } from "../../src/modules/auth/actor.js";

const orgId = newOrgId();
const projectId = newProjectId();

const fakeConfig: Pick<AppConfig, "llm" | "embedding"> = { llm: null, embedding: null };

const reviewer: Actor = { actorId: "tok_rev", organizationId: orgId, type: "service", role: "REVIEWER" };
const reader: Actor = { actorId: "tok_read", organizationId: orgId, type: "service", role: "READER" };

function seeded(extra: Collections = {}): Collections {
  return {
    projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }],
    proposals: [],
    knowledge_items: [],
    versions: [],
    audit_events: [],
    ...extra,
  };
}

function buildApp(actor: Actor, rows: Collections = seeded()): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const r = req as unknown as Record<string, unknown>;
    r.actor = actor;
    r.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerProposalRoutes(app, fakeConfig as AppConfig);
  return app;
}

const makeProposal = (overrides: Record<string, unknown> = {}) => ({
  id: newProposalId(), organizationId: orgId, projectId,
  status: "VALIDATING", type: "Architecture", title: "Overview", summary: "App overview",
  content: {}, sourceIds: [], contentHash: "abc123", triggeredBy: "bootstrap",
  createdAt: new Date().toISOString(), reviewedBy: null, reviewedAt: null, knowledgeItemId: null,
  proposedBy: "system", proposedAt: new Date().toISOString(),
  validationResults: [], rejectionReason: null, changesFeedback: null, updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("GET /organizations/:orgId/projects/:projectId/proposals", () => {
  it("returns empty array when no proposals", async () => {
    const app = buildApp(reviewer);
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals` });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposals).toEqual([]);
    await app.close();
  });

  it("returns proposals for the project", async () => {
    const app = buildApp(reviewer, seeded({ proposals: [makeProposal()] }));
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals` });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposals).toHaveLength(1);
    await app.close();
  });

  it("filters by status", async () => {
    const app = buildApp(reviewer, seeded({ proposals: [makeProposal(), makeProposal({ id: newProposalId(), status: "PUBLISHED", knowledgeItemId: "know_x" })] }));
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals?status=VALIDATING` });
    expect(res.json().proposals).toHaveLength(1);
    await app.close();
  });
});

describe("POST /organizations/:orgId/projects/:projectId/proposals", () => {
  const validBody = {
    type: "Architecture",
    title: "Payment Service",
    summary: "Handles payment processing.",
    content: { component: "PaymentService", responsibility: "Processes payments via Stripe." },
    sourceIds: [],
    triggeredBy: "manual",
  };

  it("creates a proposal in VALIDATING status and returns 201", async () => {
    const app = buildApp(reviewer);
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals`,
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.proposal.id).toMatch(/^prop_/);
    expect(body.proposal.status).toBe("VALIDATING");
    await app.close();
  });

  it("returns 400 when type is invalid", async () => {
    const app = buildApp(reviewer);
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals`,
      payload: { ...validBody, type: "InvalidType" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 409 when exact title duplicate exists", async () => {
    const existingItem = {
      id: "know_01J000000000000000000000001",
      organizationId: orgId, projectId,
      type: "Architecture", title: "Payment Service", summary: "Existing summary.",
      content: {}, status: "PUBLISHED", version: 1, ownerId: "tok_1",
      sourceIds: [], createdAt: "", updatedAt: "", lastVerifiedAt: null,
      embedding: null, embeddingModel: null, embeddingUpdatedAt: null,
    };
    const app = buildApp(reviewer, seeded({ knowledge_items: [existingItem] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals`,
      payload: validBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DUPLICATE_PROPOSAL");
    await app.close();
  });
});

describe("POST .../proposals/:id/approve", () => {
  it("returns 403 for READER role", async () => {
    const proposal = makeProposal();
    const app = buildApp(reader, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/approve`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("REVIEWER can approve and proposal becomes PUBLISHED", async () => {
    const proposal = makeProposal();
    const app = buildApp(reviewer, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proposal.status).toBe("PUBLISHED");
    expect(body.knowledgeItem).toBeDefined();
    await app.close();
  });

  it("returns 404 for unknown proposal", async () => {
    const app = buildApp(reviewer);
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${newProposalId()}/approve`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 422 when proposal is not VALIDATING", async () => {
    const proposal = makeProposal({ status: "PUBLISHED", knowledgeItemId: "know_x" });
    const app = buildApp(reviewer, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/approve`,
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});

describe("POST .../proposals/:id/reject", () => {
  it("returns 403 for READER role", async () => {
    const proposal = makeProposal();
    const app = buildApp(reader, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/reject`,
      payload: { reason: "not good" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns 400 when reason is missing", async () => {
    const proposal = makeProposal();
    const app = buildApp(reviewer, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/reject`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("REVIEWER can reject with reason", async () => {
    const proposal = makeProposal();
    const app = buildApp(reviewer, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/reject`,
      payload: { reason: "not aligned with strategy" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("REJECTED");
    await app.close();
  });
});

describe("POST .../proposals/:id/request-changes", () => {
  it("returns 403 for READER role", async () => {
    const proposal = makeProposal();
    const app = buildApp(reader, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/request-changes`,
      payload: { feedback: "needs more detail" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("REVIEWER can request changes", async () => {
    const proposal = makeProposal();
    const app = buildApp(reviewer, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/request-changes`,
      payload: { feedback: "needs more detail" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("CHANGES_REQUESTED");
    await app.close();
  });

  it("returns 400 when feedback is missing", async () => {
    const proposal = makeProposal();
    const app = buildApp(reviewer, seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/request-changes`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST .../proposals/bulk-approve", () => {
  it("returns 403 for READER role", async () => {
    const app = buildApp(reader);
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/bulk-approve`,
      payload: { ids: [newProposalId()] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("bulk approves all VALIDATING proposals and returns 207", async () => {
    const p1 = makeProposal({ id: newProposalId() });
    const p2 = makeProposal({ id: newProposalId() });
    const app = buildApp(reviewer, seeded({ proposals: [p1, p2] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/bulk-approve`,
      payload: { ids: [p1.id, p2.id] },
    });
    expect(res.statusCode).toBe(207);
    const body = res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r: { status: string }) => r.status === "approved")).toBe(true);
    await app.close();
  });

  it("returns 422 (all-or-none) when any proposal is not VALIDATING", async () => {
    const p1 = makeProposal({ id: newProposalId() });
    const p2 = makeProposal({ id: newProposalId(), status: "REJECTED" });
    const app = buildApp(reviewer, seeded({ proposals: [p1, p2] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/bulk-approve`,
      payload: { ids: [p1.id, p2.id] },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});

describe("POST .../proposals/bulk-reject", () => {
  it("returns 403 for READER role", async () => {
    const app = buildApp(reader);
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/bulk-reject`,
      payload: { ids: [newProposalId()], reason: "no" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("bulk rejects all VALIDATING proposals and returns 207", async () => {
    const p1 = makeProposal({ id: newProposalId() });
    const p2 = makeProposal({ id: newProposalId() });
    const app = buildApp(reviewer, seeded({ proposals: [p1, p2] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/bulk-reject`,
      payload: { ids: [p1.id, p2.id], reason: "out of scope" },
    });
    expect(res.statusCode).toBe(207);
    const body = res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r: { status: string }) => r.status === "rejected")).toBe(true);
    await app.close();
  });

  it("returns 422 (all-or-none) when any proposal is not VALIDATING", async () => {
    const p1 = makeProposal({ id: newProposalId() });
    const p2 = makeProposal({ id: newProposalId(), status: "PUBLISHED", knowledgeItemId: "know_x" });
    const app = buildApp(reviewer, seeded({ proposals: [p1, p2] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/bulk-reject`,
      payload: { ids: [p1.id, p2.id], reason: "no" },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
