import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

const seeded = (extra: Collections = {}): Collections => ({
  projects: [project],
  sources: [],
  ...extra,
});

function buildApp(rows: Collections, withAuth = true): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    if (withAuth) enriched.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    enriched.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerSourceRoutes(app);
  return app;
}

async function createSource(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/sources",
    payload: { projectId, type: "git_commit", locator: "abc123", metadata: { sha: "abc123" }, ...overrides },
  });
}

describe("POST /sources", () => {
  it("creates a source and returns 201", async () => {
    const app = buildApp(seeded());
    const res = await createSource(app);
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; locator: string };
    expect(body.id).toMatch(/^src_/);
    expect(body.locator).toBe("abc123");
    await app.close();
  });

  it("returns 404 when the project does not exist", async () => {
    const app = buildApp(seeded());
    const res = await createSource(app, { projectId: newProjectId() });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for a bad type or empty locator", async () => {
    const app = buildApp(seeded());
    expect((await createSource(app, { type: "nope" })).statusCode).toBe(400);
    expect((await createSource(app, { locator: "" })).statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = buildApp(seeded(), false);
    expect((await createSource(app)).statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /sources/:id and list", () => {
  it("returns a created source and 404 for a missing one", async () => {
    const app = buildApp(seeded());
    const id = (await createSource(app)).json().id as string;
    expect((await app.inject({ method: "GET", url: `/sources/${id}` })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/sources/src_00000000000000000000000000" })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("returns 400 for a malformed id", async () => {
    const app = buildApp(seeded());
    expect((await app.inject({ method: "GET", url: "/sources/not-an-id" })).statusCode).toBe(400);
    await app.close();
  });

  it("lists sources filtered by type", async () => {
    const app = buildApp(seeded());
    await createSource(app);
    await createSource(app, { type: "document", locator: "doc-1" });
    const res = await app.inject({ method: "GET", url: `/sources?projectId=${projectId}&type=document` });
    expect(res.statusCode).toBe(200);
    const { sources } = res.json() as { sources: { type: string }[] };
    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("document");
    await app.close();
  });
});

describe("DELETE /sources/:id", () => {
  it("deletes and returns 204, then 404 on the second delete", async () => {
    const app = buildApp(seeded());
    const id = (await createSource(app)).json().id as string;
    expect((await app.inject({ method: "DELETE", url: `/sources/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/sources/${id}` })).statusCode).toBe(404);
    await app.close();
  });
});
