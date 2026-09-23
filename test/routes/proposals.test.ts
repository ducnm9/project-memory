import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect } from "vitest";
import { registerProposalRoutes } from "../../src/routes/proposals.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { newProposalId } from "../../src/modules/ingestion/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_1";
const projectId = newProjectId();

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
  registerProposalRoutes(app);
  return app;
}

const makeProposal = (overrides = {}) => ({
  id: newProposalId(), organizationId: orgId, projectId,
  status: "PROPOSED", type: "Architecture", title: "Overview", summary: "App overview",
  content: {}, sourceIds: [], contentHash: "abc123", triggeredBy: "bootstrap",
  createdAt: new Date().toISOString(), reviewedBy: null, reviewedAt: null, knowledgeItemId: null,
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
    const app = buildApp(seeded({ proposals: [makeProposal(), makeProposal({ id: newProposalId(), status: "APPROVED", knowledgeItemId: "know_x" })] }));
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/projects/${projectId}/proposals?status=PROPOSED` });
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
    expect(body.status).toBe("APPROVED");
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
