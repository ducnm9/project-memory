import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerRelationRoutes } from "../../src/routes/relations.js";
import { registerRelationVersionRoutes } from "../../src/routes/relation-versions.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };
const seeded = (): Collections => ({ projects: [project], relations: [], relation_versions: [] });

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
  registerRelationVersionRoutes(app);
  return app;
}

const validBody = { projectId, subjectId: "a", predicate: "depends_on", objectId: "b" };
const create = (app: FastifyInstance) => app.inject({ method: "POST", url: "/relations", payload: validBody });

describe("relation versions", () => {
  it("lists an initial version after create", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "GET", url: `/relations/${id}/versions` });
    expect(res.json().versions).toHaveLength(1);
    expect(res.json().versions[0].version).toBe(1);
    await app.close();
  });

  it("records a new version per write and diffs two versions", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "ACCEPTED" } });
    const list = await app.inject({ method: "GET", url: `/relations/${id}/versions` });
    expect(list.json().versions).toHaveLength(2);
    const diff = await app.inject({ method: "GET", url: `/relations/${id}/versions/1/diff/2` });
    expect(diff.json().changes.status).toEqual({ from: "PROPOSED", to: "ACCEPTED" });
    expect(diff.json().changes.reviewerId).toEqual({ from: null, to: "tok_1" });
    expect(diff.json().changes.version).toBeUndefined();
    await app.close();
  });

  it("404 on unknown version", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "GET", url: `/relations/${id}/versions/99` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
