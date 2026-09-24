import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createFakeDb } from "../support/fake-db.js";
import { registerConflictRoutes } from "../../src/routes/conflicts.js";
import type { Actor } from "../../src/modules/auth/actor.js";

const reviewer: Actor = { actorId: "tok_rev", organizationId: "org_1", type: "service", role: "REVIEWER" };
const reader: Actor = { actorId: "tok_read", organizationId: "org_1", type: "service", role: "READER" };

function buildApp(actor: Actor | undefined) {
  const { db, rows } = createFakeDb({
    conflicts: [], proposals: [], knowledge_items: [], audit_events: [],
  });
  const app = Fastify();
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    (req as unknown as Record<string, unknown>).actor = actor;
  });
  registerConflictRoutes(app as unknown as FastifyInstance);
  return { app, rows };
}

describe("GET /organizations/:orgId/projects/:projectId/conflicts", () => {
  it("returns empty list", async () => {
    const { app } = buildApp(reviewer);
    const res = await app.inject({ method: "GET", url: "/organizations/org_1/projects/proj_1/conflicts" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).conflicts).toEqual([]);
  });
});

describe("POST /conflicts/:id/resolve", () => {
  it("returns 403 for READER", async () => {
    const { app, rows } = buildApp(reader);
    rows.conflicts.push({
      id: "conf_01", organizationId: "org_1", projectId: "proj_1",
      proposalId: "prop_01", conflictingKnowledgeId: "know_01",
      explanation: "they differ", status: "OPEN", resolution: null,
      mergedContent: null, resolvedBy: null, resolvedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "POST", url: "/conflicts/conf_01/resolve",
      payload: { action: "KEEP_EXISTING" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("KEEP_EXISTING rejects proposal and closes conflict", async () => {
    const { app, rows } = buildApp(reviewer);
    rows.conflicts.push({
      id: "conf_01", organizationId: "org_1", projectId: "proj_1",
      proposalId: "prop_01", conflictingKnowledgeId: "know_01",
      explanation: "they differ", status: "OPEN", resolution: null,
      mergedContent: null, resolvedBy: null, resolvedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    rows.proposals.push({
      id: "prop_01", organizationId: "org_1", projectId: "proj_1",
      status: "VALIDATING", type: "Decision", title: "T", summary: "S", content: {},
      sourceIds: [], contentHash: "h", triggeredBy: "manual", proposedBy: "tok_1",
      validationResults: [], reviewedBy: null, reviewedAt: null,
      rejectionReason: null, changesFeedback: null, knowledgeItemId: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      proposedAt: "2026-01-01T00:00:00.000Z",
    });
    rows.audit_events = [];
    const res = await app.inject({
      method: "POST", url: "/conflicts/conf_01/resolve",
      payload: { action: "KEEP_EXISTING" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("RESOLVED");
    expect(body.resolution).toBe("KEEP_EXISTING");
    expect(rows.proposals[0].status).toBe("REJECTED");
  });
});
