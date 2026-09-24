import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect } from "vitest";
import { registerProposalRoutes } from "../../src/routes/proposals.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";
import { newProposalId } from "../../src/modules/ingestion/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";
import type { AppConfig } from "../../src/config/index.js";

const orgId = newOrgId();
const projectId = newProjectId();

const fakeConfig: Pick<AppConfig, "llm" | "embedding"> = { llm: null, embedding: null };

function buildApp(rows: Collections): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const r = req as unknown as Record<string, unknown>;
    r.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    r.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerProposalRoutes(app, fakeConfig as AppConfig);
  return app;
}

const makeProposal = (overrides = {}) => ({
  id: newProposalId(), organizationId: orgId, projectId,
  status: "VALIDATING", type: "Architecture", title: "Overview", summary: "App overview",
  content: {}, sourceIds: [], contentHash: "abc123", triggeredBy: "bootstrap",
  createdAt: new Date().toISOString(), reviewedBy: null, reviewedAt: null, knowledgeItemId: null,
  proposedBy: "system", proposedAt: new Date().toISOString(),
  validationResults: [], rejectionReason: null, changesFeedback: null, updatedAt: new Date().toISOString(),
  ...overrides,
});

const seeded = (extra: Collections = {}): Collections => ({
  projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }],
  proposals: [],
  knowledge_items: [],
  versions: [],
  audit_events: [],
  ...extra,
});

describe("GET /organizations/:orgId/projects/:projectId/proposals", () => {
  it("returns empty array when no proposals", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals` });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposals).toEqual([]);
    await app.close();
  });

  it("returns proposals for the project", async () => {
    const app = buildApp(seeded({ proposals: [makeProposal()] }));
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals` });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposals).toHaveLength(1);
    await app.close();
  });

  it("filters by status", async () => {
    const app = buildApp(seeded({ proposals: [makeProposal(), makeProposal({ id: newProposalId(), status: "PUBLISHED", knowledgeItemId: "know_x" })] }));
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals?status=VALIDATING` });
    expect(res.json().proposals).toHaveLength(1);
    await app.close();
  });
});

describe("POST .../proposals/:id/approve", () => {
  it("approves a proposal and creates a knowledge item", async () => {
    const proposal = makeProposal();
    const app = buildApp(seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/approve`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("PUBLISHED");
    expect(body.knowledgeItemId).toMatch(/^know_/);
    await app.close();
  });

  it("returns 404 for unknown proposal", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${newProposalId()}/approve`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 422 when a sourceId does not resolve to a real source", async () => {
    const proposal = makeProposal({ sourceIds: ["src_01J000000000000000000000001"] });
    const app = buildApp(seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/approve`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("EVIDENCE_VALIDATION_ERROR");
    await app.close();
  });

  it("approves a Decision proposal with no sources and includes a warning", async () => {
    const proposal = makeProposal({ type: "Decision", sourceIds: [], triggeredBy: "bootstrap" });
    const app = buildApp(seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/approve`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toContain("no supporting sources provided");
    await app.close();
  });

  it("approves a manual proposal with no sources without warning", async () => {
    const proposal = makeProposal({ type: "Decision", sourceIds: [], triggeredBy: "manual" });
    const app = buildApp(seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/approve`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toBeUndefined();
    await app.close();
  });
});

describe("POST .../proposals/:id/reject", () => {
  it("rejects a proposal", async () => {
    const proposal = makeProposal();
    const app = buildApp(seeded({ proposals: [proposal] }));
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals/${proposal.id}/reject`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("REJECTED");
    await app.close();
  });
});

describe("POST /organizations/:orgId/projects/:projectId/proposals", () => {
  const validBody = {
    projectId,
    type: "Architecture",
    title: "Payment Service",
    summary: "Handles payment processing.",
    content: {
      component: "PaymentService",
      responsibility: "Processes payments via Stripe.",
    },
    sourceIds: [],
    triggeredBy: "manual",
  };

  it("creates a proposal and returns 201", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals`,
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^prop_/);
    expect(body.status).toBe("VALIDATING");
    await app.close();
  });

  it("returns 400 when required content field is missing", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/proposals`,
      payload: { ...validBody, content: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/component/);
    await app.close();
  });

  it("returns 400 when type is invalid", async () => {
    const app = buildApp(seeded());
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
      organizationId: orgId,
      projectId,
      type: "Architecture",
      title: "Payment Service",
      summary: "Existing summary.",
      content: {},
      status: "PUBLISHED",
      version: 1,
      ownerId: "tok_1",
      sourceIds: [],
      createdAt: "",
      updatedAt: "",
      lastVerifiedAt: null,
      embedding: null,
      embeddingModel: null,
      embeddingUpdatedAt: null,
    };
    const app = buildApp(seeded({ knowledge_items: [existingItem] }));
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
