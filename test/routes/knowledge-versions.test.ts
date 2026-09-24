import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerKnowledgeVersionRoutes } from "../../src/routes/knowledge-versions.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

interface VersionResponse {
  version: number;
  snapshot: { version: number; title: string };
}
interface DiffResponse {
  from: number;
  to: number;
  changes: Record<string, { from: unknown; to: unknown }>;
}

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
  return app;
}

const seeded = (extra: Collections = {}): Collections => ({
  projects: [project],
  knowledge_items: [],
  knowledge_versions: [],
  ...extra,
});

// Helper: create an item and patch it n times, return the item id.
async function seedItemWithPatches(app: FastifyInstance, patches: number): Promise<string> {
  const created = (await app.inject({
    method: "POST",
    url: "/knowledge",
    payload: {
      projectId,
      type: "Concept",
      title: "t0",
      summary: "s",
      content: { definition: "d" },
    },
  })).json() as { id: string };
  for (let i = 1; i <= patches; i++) {
    await app.inject({ method: "PATCH", url: `/knowledge/${created.id}`, payload: { title: `t${i}` } });
  }
  return created.id;
}

describe("GET /knowledge/:id/versions", () => {
  it("returns 4 versions after create + 3 patches (acceptance criterion)", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 3);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions` });
    expect(res.statusCode).toBe(200);
    const { versions } = res.json() as { versions: VersionResponse[] };
    expect(versions).toHaveLength(4);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
    await app.close();
  });

  it("returns 404 for unknown item", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const res = await app.inject({ method: "GET", url: "/knowledge/know_00000000000000000000000000/versions" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const { db } = createFakeDb(seeded());
    const app = Fastify({ logger: false });
    app.decorate("db", db);
    app.addHook("onRequest", async (req) => {
      const enriched = req as unknown as { projectContext: unknown };
      enriched.projectContext = { organizationId: orgId, projectId: null };
    });
    registerErrorHandler(app);
    registerKnowledgeVersionRoutes(app);
    const res = await app.inject({ method: "GET", url: "/knowledge/know_00000000000000000000000000/versions" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /knowledge/:id/versions/:v", () => {
  it("returns the exact snapshot for a specific version", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 2);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1` });
    expect(res.statusCode).toBe(200);
    const ver = res.json() as VersionResponse;
    expect(ver.version).toBe(1);
    expect(ver.snapshot.version).toBe(1);
    expect(ver.snapshot.title).toBe("t0"); // original title preserved
    await app.close();
  });

  it("returns 404 for a version number that does not exist", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/99` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for a non-integer version param", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/abc` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /knowledge/:id/versions/:from/diff/:to", () => {
  it("returns only changed fields with from/to values", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    // v1: title=t0, v2: title=t1
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1/diff/2` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as DiffResponse;
    expect(body.from).toBe(1);
    expect(body.to).toBe(2);
    expect(body.changes.title).toEqual({ from: "t0", to: "t1" });
    expect(body.changes.version).toBeUndefined(); // excluded
    expect(body.changes.updatedAt).toBeUndefined(); // excluded
    await app.close();
  });

  it("returns empty changes when from == to", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1/diff/1` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as DiffResponse).changes).toEqual({});
    await app.close();
  });

  it("returns 404 if one of the versions does not exist", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1/diff/99` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for non-integer from/to", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/abc/diff/2` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
