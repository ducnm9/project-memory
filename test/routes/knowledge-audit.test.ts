import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { registerAuditEventRoutes } from "../../src/routes/audit-events.js";
import { newKnowledgeItemId } from "../../src/modules/knowledge-core/entities.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";
import type { AuditEvent } from "../../src/modules/governance/audit-entities.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

function buildApp(rows: Collections): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    enriched.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    enriched.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerKnowledgeRoutes(app);
  registerAuditEventRoutes(app);
  return app;
}

const seeded = (extra: Collections = {}): Collections => ({
  projects: [project],
  knowledge_items: [],
  audit_events: [],
  ...extra,
});

const auditEventsOf = (rows: Collections): AuditEvent[] =>
  (rows.audit_events ?? []) as unknown as AuditEvent[];

describe("AuditEvent — immutability", () => {
  it("PATCH /audit-events/:id returns 405", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "PATCH", url: "/audit-events/aevt_123" });
    expect(res.statusCode).toBe(405);
    await app.close();
  });

  it("DELETE /audit-events/:id returns 405", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "DELETE", url: "/audit-events/aevt_123" });
    expect(res.statusCode).toBe(405);
    await app.close();
  });
});

describe("AuditEvent — POST /knowledge emits CREATE", () => {
  it("creates a CREATE audit event after POST /knowledge", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Concept", title: "t", summary: "s", content: { definition: "d" } },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json();
    const events = auditEventsOf(rows);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("CREATE");
    expect(events[0].targetId).toBe(item.id);
    expect(events[0].targetType).toBe("knowledge");
    expect(events[0].actorId).toBe("tok_1");
    expect(events[0].newVersion).toBe(1);
    await app.close();
  });
});

describe("AuditEvent — PATCH /knowledge/:id emits correct event types", () => {
  const base = {
    id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
    title: "t", summary: "s", content: {}, status: "PROPOSED", version: 2,
    ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
  };

  it("emits APPROVE when status → ACCEPTED", async () => {
    const rows = seeded({ knowledge_items: [{ ...base }], audit_events: [] });
    const app = buildApp(rows);
    await app.inject({ method: "PATCH", url: `/knowledge/${base.id}`, payload: { status: "VALIDATING" } });
    // now patch to ACCEPTED
    await app.inject({ method: "PATCH", url: `/knowledge/${base.id}`, payload: { status: "ACCEPTED" } });
    const events = auditEventsOf(rows);
    const approve = events.find((e) => e.eventType === "APPROVE");
    expect(approve).toBeDefined();
    expect(approve?.targetId).toBe(base.id);
    await app.close();
  });

  it("emits REJECT when status → REJECTED", async () => {
    const rows = seeded({ knowledge_items: [{ ...base }], audit_events: [] });
    const app = buildApp(rows);
    await app.inject({ method: "PATCH", url: `/knowledge/${base.id}`, payload: { status: "VALIDATING" } });
    await app.inject({ method: "PATCH", url: `/knowledge/${base.id}`, payload: { status: "REJECTED" } });
    const events = auditEventsOf(rows);
    expect(events.find((e) => e.eventType === "REJECT")).toBeDefined();
    await app.close();
  });

  it("emits UPDATE for a plain field change", async () => {
    const rows = seeded({ knowledge_items: [{ ...base }], audit_events: [] });
    const app = buildApp(rows);
    await app.inject({ method: "PATCH", url: `/knowledge/${base.id}`, payload: { title: "new" } });
    const events = auditEventsOf(rows);
    expect(events[0].eventType).toBe("UPDATE");
    await app.close();
  });
});

describe("AuditEvent — GET /knowledge/:id/audit", () => {
  it("returns the audit trail for a knowledge item", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Concept", title: "t", summary: "s", content: { definition: "d" } },
    })).json();
    await app.inject({ method: "PATCH", url: `/knowledge/${created.id}`, payload: { title: "updated" } });

    const auditRes = await app.inject({ method: "GET", url: `/knowledge/${created.id}/audit` });
    expect(auditRes.statusCode).toBe(200);
    const { events } = auditRes.json();
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe("CREATE");
    expect(events[1].eventType).toBe("UPDATE");
    await app.close();
  });

  it("returns 404 for an unknown knowledge item", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: `/knowledge/${newKnowledgeItemId()}/audit` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("includes actorId in each audit event", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Concept", title: "t", summary: "s", content: { definition: "d" } },
    })).json();
    const auditRes = await app.inject({ method: "GET", url: `/knowledge/${created.id}/audit` });
    const { events } = auditRes.json();
    expect(events[0].actorId).toBe("tok_1");
    await app.close();
  });
});
