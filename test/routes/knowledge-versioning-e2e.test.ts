import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerKnowledgeVersionRoutes } from "../../src/routes/knowledge-versions.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_E2E";
const projectId = newProjectId();

function buildApp() {
  const rows: Collections = {
    projects: [{ id: projectId, organizationId: orgId, name: "e2e", createdAt: "", updatedAt: "" }],
    knowledge_items: [],
    knowledge_versions: [],
  };
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    enriched.actor = { actorId: "tok_e2e", organizationId: orgId, type: "service" };
    enriched.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerKnowledgeRoutes(app);
  registerKnowledgeVersionRoutes(app);
  return app;
}

describe("Knowledge versioning — acceptance criterion", () => {
  it("3 updates produce 4 version entries and each snapshot is retrievable", async () => {
    const app = buildApp();

    // Create item — v1
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: {
        projectId, type: "Concept", title: "original", summary: "s",
        content: { definition: "d" },
      },
    })).json();
    expect(created.version).toBe(1);
    const id = created.id;

    // Patch 1 — v2
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "update-1", changeSummary: "first edit" } });
    // Patch 2 — v3
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { summary: "updated summary" } });
    // Patch 3 — v4
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "update-3" } });

    // List — must have 4 entries
    const listRes = await app.inject({ method: "GET", url: `/knowledge/${id}/versions` });
    expect(listRes.statusCode).toBe(200);
    const { versions } = listRes.json();
    expect(versions).toHaveLength(4);
    expect(versions.map((v: { version: number }) => v.version)).toEqual([1, 2, 3, 4]);

    // v1 snapshot preserved original title
    const v1Res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1` });
    expect(v1Res.json().snapshot.title).toBe("original");

    // v2 has caller changeSummary
    const v2Res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/2` });
    expect(v2Res.json().changeSummary).toBe("first edit");

    // v3 auto-generated changeSummary
    const v3Res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/3` });
    expect(v3Res.json().changeSummary).toBe("changed: summary");

    // diff v1 → v3 shows title and summary changed
    const diffRes = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1/diff/3` });
    expect(diffRes.statusCode).toBe(200);
    const diff = diffRes.json();
    expect(diff.changes.title).toBeDefined();
    expect(diff.changes.summary).toBeDefined();
    expect(diff.changes.version).toBeUndefined();

    await app.close();
  });
});
