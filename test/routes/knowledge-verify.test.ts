import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newKnowledgeItemId } from "../../src/modules/knowledge-core/entities.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections, type Row } from "../support/fake-db.js";

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
  registerKnowledgeRoutes(app, { embedding: null } as import("../../src/config/index.js").AppConfig);
  return app;
}

function makeItem(overrides: Partial<Row> = {}): Row {
  return {
    id: newKnowledgeItemId(), organizationId: orgId, projectId,
    type: "Procedure", title: "T", summary: "S", content: {},
    status: "PUBLISHED", version: 1, ownerId: "tok_1",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: null,
    sourceIds: [], embedding: null, embeddingModel: null, embeddingUpdatedAt: null,
    ...overrides,
  };
}

const seeded = (extra: Collections = {}): Collections => ({
  projects: [project],
  knowledge_items: [],
  audit_events: [],
  knowledge_versions: [],
  ...extra,
});

describe("PATCH /knowledge/:id/verify", () => {
  it("sets lastVerifiedAt and returns 200 for PUBLISHED item", async () => {
    const item = makeItem();
    const rows = seeded({ knowledge_items: [item] });
    const app = buildApp(rows);

    const res = await app.inject({
      method: "PATCH",
      url: `/knowledge/${item.id}/verify`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lastVerifiedAt).toBeTruthy();
    expect(body.status).toBe("PUBLISHED");
    await app.close();
  });

  it("transitions STALE → PUBLISHED on verify", async () => {
    const item = makeItem({ status: "STALE", lastVerifiedAt: "2020-01-01T00:00:00.000Z" });
    const rows = seeded({ knowledge_items: [item] });
    const app = buildApp(rows);

    const res = await app.inject({
      method: "PATCH",
      url: `/knowledge/${item.id}/verify`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("PUBLISHED");
    expect(body.lastVerifiedAt).toBeTruthy();
    await app.close();
  });

  it("returns 404 for unknown id", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "PATCH",
      url: `/knowledge/${newKnowledgeItemId()}/verify`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("emits VERIFY audit event", async () => {
    const item = makeItem();
    const rows = seeded({ knowledge_items: [item] });
    const app = buildApp(rows);

    await app.inject({ method: "PATCH", url: `/knowledge/${item.id}/verify` });

    const events = (rows.audit_events ?? []) as Row[];
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].eventType).toBe("VERIFY");
    expect(events[events.length - 1].targetId).toBe(item.id);
    await app.close();
  });
});
