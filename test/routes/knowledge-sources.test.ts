import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerKnowledgeVersionRoutes } from "../../src/routes/knowledge-versions.js";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

const seeded = (): Collections => ({
  projects: [project],
  knowledge_items: [],
  knowledge_versions: [],
  sources: [],
});

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
  registerKnowledgeVersionRoutes(app);
  registerSourceRoutes(app);
  return app;
}

async function seedItem(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/knowledge",
    payload: { projectId, type: "Concept", title: "t", summary: "s", content: { definition: "d" } },
  });
  return (res.json() as { id: string }).id;
}

async function seedSource(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/sources",
    payload: { projectId, type: "git_commit", locator: "abc123" },
  });
  return (res.json() as { id: string }).id;
}

describe("POST /knowledge/:id/sources", () => {
  it("attaches a source, bumps version, and records a version snapshot", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const sourceId = await seedSource(app);
    const res = await app.inject({
      method: "POST",
      url: `/knowledge/${itemId}/sources`,
      payload: { sourceId },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json() as { sourceIds: string[]; version: number };
    expect(item.sourceIds).toEqual([sourceId]);
    expect(item.version).toBe(2);

    const versions = (
      await app.inject({ method: "GET", url: `/knowledge/${itemId}/versions` })
    ).json() as { versions: unknown[] };
    expect(versions.versions).toHaveLength(2);
    await app.close();
  });

  it("is idempotent when the source is already attached", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const sourceId = await seedSource(app);
    await app.inject({ method: "POST", url: `/knowledge/${itemId}/sources`, payload: { sourceId } });
    const second = await app.inject({
      method: "POST",
      url: `/knowledge/${itemId}/sources`,
      payload: { sourceId },
    });
    const item = second.json() as { sourceIds: string[]; version: number };
    expect(item.sourceIds).toEqual([sourceId]);
    expect(item.version).toBe(2); // unchanged
    const versions = (
      await app.inject({ method: "GET", url: `/knowledge/${itemId}/versions` })
    ).json() as { versions: unknown[] };
    expect(versions.versions).toHaveLength(2); // no new snapshot
    await app.close();
  });

  it("returns 404 for a non-existent source", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const res = await app.inject({
      method: "POST",
      url: `/knowledge/${itemId}/sources`,
      payload: { sourceId: "src_00000000000000000000000000" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 404 for a non-existent item", async () => {
    const app = buildApp(seeded());
    const sourceId = await seedSource(app);
    const res = await app.inject({
      method: "POST",
      url: `/knowledge/know_00000000000000000000000000/sources`,
      payload: { sourceId },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("attaches to a pre-PM-013 item that has no sourceIds field", async () => {
    const rows = seeded();
    // Simulate a legacy item written before the sourceIds field existed.
    (rows.knowledge_items as unknown[]).push({
      id: "know_00000000000000000000000000",
      organizationId: orgId,
      projectId,
      type: "Concept",
      title: "legacy",
      summary: "s",
      content: {},
      status: "DISCOVERED",
      version: 1,
      ownerId: "tok_1",
      createdAt: "",
      updatedAt: "",
      lastVerifiedAt: null,
      // no sourceIds
    });
    const app = buildApp(rows);
    const sourceId = await seedSource(app);
    const res = await app.inject({
      method: "POST",
      url: `/knowledge/know_00000000000000000000000000/sources`,
      payload: { sourceId },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { sourceIds: string[] }).sourceIds).toEqual([sourceId]);
    await app.close();
  });
});

describe("DELETE /knowledge/:id/sources/:sourceId", () => {
  it("detaches a linked source and bumps version", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const sourceId = await seedSource(app);
    await app.inject({ method: "POST", url: `/knowledge/${itemId}/sources`, payload: { sourceId } });
    const res = await app.inject({ method: "DELETE", url: `/knowledge/${itemId}/sources/${sourceId}` });
    expect(res.statusCode).toBe(200);
    const item = res.json() as { sourceIds: string[]; version: number };
    expect(item.sourceIds).toEqual([]);
    expect(item.version).toBe(3);
    await app.close();
  });

  it("returns 404 when the link is absent", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const sourceId = await seedSource(app);
    const res = await app.inject({ method: "DELETE", url: `/knowledge/${itemId}/sources/${sourceId}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
