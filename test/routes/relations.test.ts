import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerRelationRoutes } from "../../src/routes/relations.js";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

const seeded = (): Collections => ({
  projects: [project],
  relations: [],
  relation_versions: [],
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
  registerRelationRoutes(app);
  registerSourceRoutes(app);
  return app;
}

const validBody = { projectId, subjectId: "matter-history", predicate: "depends_on", objectId: "audit-log" };
const create = (app: FastifyInstance, body: Record<string, unknown> = validBody) =>
  app.inject({ method: "POST", url: "/relations", payload: body });

async function seedSource(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sources", payload: { projectId, type: "git_commit", locator: "abc123" } });
  return (res.json() as { id: string }).id;
}

describe("POST /relations", () => {
  it("creates at version 1, PROPOSED, null reviewer, 201", async () => {
    const app = buildApp(seeded());
    const res = await create(app);
    expect(res.statusCode).toBe(201);
    const rel = res.json();
    expect(rel.id).toMatch(/^rel_/);
    expect(rel.version).toBe(1);
    expect(rel.status).toBe("PROPOSED");
    expect(rel.reviewerId).toBeNull();
    await app.close();
  });

  it("rejects an off-vocabulary predicate with 400", async () => {
    const app = buildApp(seeded());
    const res = await create(app, { ...validBody, predicate: "causes" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404 when project does not exist", async () => {
    const app = buildApp(seeded());
    const res = await create(app, { ...validBody, projectId: newProjectId() });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /relations/:id reviewer stamping", () => {
  it("stamps reviewerId on PROPOSED -> ACCEPTED", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "ACCEPTED" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().reviewerId).toBe("tok_1");
    await app.close();
  });

  it("rejects an illegal transition with 422", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "DEPRECATED" } });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it("does not re-stamp reviewer on ACCEPTED -> DEPRECATED", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "ACCEPTED" } });
    const dep = await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "DEPRECATED" } });
    expect(dep.json().reviewerId).toBe("tok_1");
    await app.close();
  });
});

describe("GET /relations filters and 404s", () => {
  it("filters by predicate", async () => {
    const app = buildApp(seeded());
    await create(app);
    await create(app, { ...validBody, predicate: "fixes" });
    const res = await app.inject({ method: "GET", url: `/relations?projectId=${projectId}&predicate=depends_on` });
    expect(res.json().relations).toHaveLength(1);
    await app.close();
  });

  it("404 on unknown id", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: "/relations/rel_00000000000000000000000000" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("relation sources", () => {
  it("attaches idempotently and detaches", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const sourceId = await seedSource(app);
    const a1 = await app.inject({ method: "POST", url: `/relations/${id}/sources`, payload: { sourceId } });
    expect(a1.json().sourceIds).toEqual([sourceId]);
    const a2 = await app.inject({ method: "POST", url: `/relations/${id}/sources`, payload: { sourceId } });
    expect(a2.json().sourceIds).toEqual([sourceId]); // idempotent
    const d = await app.inject({ method: "DELETE", url: `/relations/${id}/sources/${sourceId}` });
    expect(d.json().sourceIds).toEqual([]);
    await app.close();
  });
});

describe("DELETE /relations/:id", () => {
  it("204 then 404", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    expect((await app.inject({ method: "DELETE", url: `/relations/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/relations/${id}` })).statusCode).toBe(404);
    await app.close();
  });
});
