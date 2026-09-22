import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerFactRoutes } from "../../src/routes/facts.js";
import { registerFactVersionRoutes } from "../../src/routes/fact-versions.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_V";
const projectId = newProjectId();

function buildApp(): FastifyInstance {
  const rows: Collections = {
    projects: [{ id: projectId, organizationId: orgId, name: "v", createdAt: "", updatedAt: "" }],
    facts: [],
    fact_versions: [],
  };
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    enriched.actor = { actorId: "tok_v", organizationId: orgId, type: "service" };
    enriched.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerFactRoutes(app);
  registerFactVersionRoutes(app);
  return app;
}

describe("Fact versioning", () => {
  it("2 patches produce 3 versions, snapshots retrievable, diff works", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST", url: "/facts",
      payload: { projectId, subjectId: "s", predicate: "depends_on", objectId: "o" },
    })).json();
    expect(created.version).toBe(1);
    const id = created.id;

    await app.inject({ method: "PATCH", url: `/facts/${id}`, payload: { predicate: "impacts", changeSummary: "reclassify" } });
    await app.inject({ method: "PATCH", url: `/facts/${id}`, payload: { status: "ACCEPTED" } });

    const list = (await app.inject({ method: "GET", url: `/facts/${id}/versions` })).json();
    expect(list.versions.map((v: { version: number }) => v.version)).toEqual([1, 2, 3]);

    const v1 = (await app.inject({ method: "GET", url: `/facts/${id}/versions/1` })).json();
    expect(v1.snapshot.predicate).toBe("depends_on");
    const v2 = (await app.inject({ method: "GET", url: `/facts/${id}/versions/2` })).json();
    expect(v2.changeSummary).toBe("reclassify");
    const v3 = (await app.inject({ method: "GET", url: `/facts/${id}/versions/3` })).json();
    expect(v3.changeSummary).toBe("changed: status");

    const diff = (await app.inject({ method: "GET", url: `/facts/${id}/versions/1/diff/2` })).json();
    expect(diff.changes.predicate).toBeDefined();
    expect(diff.changes.version).toBeUndefined();

    const missing = await app.inject({ method: "GET", url: `/facts/${id}/versions/9` });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("404 versions for an unknown fact", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/facts/fact_00000000000000000000000000/versions" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
