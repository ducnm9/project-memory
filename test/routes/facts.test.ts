import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerFactRoutes } from "../../src/routes/facts.js";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

const seeded = (): Collections => ({
  projects: [project],
  facts: [],
  fact_versions: [],
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
  registerFactRoutes(app);
  registerSourceRoutes(app);
  return app;
}

const validBody = { projectId, subjectId: "matter-history", predicate: "depends_on", objectId: "audit-log" };

async function create(app: FastifyInstance, body: Record<string, unknown> = validBody) {
  return app.inject({ method: "POST", url: "/facts", payload: body });
}

async function seedSource(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/sources",
    payload: { projectId, type: "git_commit", locator: "abc123" },
  });
  return (res.json() as { id: string }).id;
}

describe("POST /facts", () => {
  it("creates a fact at version 1, status PROPOSED, 201", async () => {
    const app = buildApp(seeded());
    const res = await create(app);
    expect(res.statusCode).toBe(201);
    const fact = res.json();
    expect(fact.id).toMatch(/^fact_/);
    expect(fact.version).toBe(1);
    expect(fact.status).toBe("PROPOSED");
    expect(fact.sourceIds).toEqual([]);
    await app.close();
  });

  it("rejects a status supplied at creation (strict body)", async () => {
    const app = buildApp(seeded());
    const res = await create(app, { ...validBody, status: "ACCEPTED" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404 when the project does not exist", async () => {
    const app = buildApp(seeded());
    const res = await create(app, { ...validBody, projectId: newProjectId() });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /facts", () => {
  it("filters by predicate", async () => {
    const app = buildApp(seeded());
    await create(app);
    await create(app, { ...validBody, predicate: "impacts" });
    const res = await app.inject({ method: "GET", url: `/facts?projectId=${projectId}&predicate=impacts` });
    expect(res.statusCode).toBe(200);
    expect(res.json().facts).toHaveLength(1);
    await app.close();
  });
});

describe("GET /facts/:id", () => {
  it("returns the fact, 404 for a missing one", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    expect((await app.inject({ method: "GET", url: `/facts/${id}` })).statusCode).toBe(200);
    const missing = await app.inject({ method: "GET", url: "/facts/fact_00000000000000000000000000" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /facts/:id", () => {
  it("applies a valid status transition and bumps version", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "PATCH", url: `/facts/${id}`, payload: { status: "ACCEPTED" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ACCEPTED");
    expect(res.json().version).toBe(2);
    await app.close();
  });

  it("422 on an illegal status transition", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "PATCH", url: `/facts/${id}`, payload: { status: "DEPRECATED" } });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it("400 on an empty patch", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "PATCH", url: `/facts/${id}`, payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("DELETE /facts/:id", () => {
  it("deletes with 204, then 404", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    expect((await app.inject({ method: "DELETE", url: `/facts/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/facts/${id}` })).statusCode).toBe(404);
    await app.close();
  });
});

describe("POST /facts/:id/sources", () => {
  it("attaches a source, bumps version, and is idempotent", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const sourceId = await seedSource(app);
    const res = await app.inject({ method: "POST", url: `/facts/${id}/sources`, payload: { sourceId } });
    expect(res.statusCode).toBe(200);
    expect(res.json().sourceIds).toEqual([sourceId]);
    expect(res.json().version).toBe(2);
    // idempotent: no second bump
    const again = await app.inject({ method: "POST", url: `/facts/${id}/sources`, payload: { sourceId } });
    expect(again.json().version).toBe(2);
    await app.close();
  });

  it("404 when the source does not exist", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "POST", url: `/facts/${id}/sources`, payload: { sourceId: "src_00000000000000000000000000" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("DELETE /facts/:id/sources/:sourceId", () => {
  it("detaches a source and bumps version", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const sourceId = await seedSource(app);
    await app.inject({ method: "POST", url: `/facts/${id}/sources`, payload: { sourceId } });
    const res = await app.inject({ method: "DELETE", url: `/facts/${id}/sources/${sourceId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().sourceIds).toEqual([]);
    await app.close();
  });
});
