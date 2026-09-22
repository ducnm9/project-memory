import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgA = "org_A";
const orgB = "org_B";
const projectId = newProjectId();

function appForOrg(org: string, rows: Collections): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    enriched.actor = { actorId: "tok", organizationId: org, type: "service" };
    enriched.projectContext = { organizationId: org, projectId: null };
  });
  registerErrorHandler(app);
  registerSourceRoutes(app);
  return app;
}

describe("source tenant isolation", () => {
  it("org B cannot read or delete org A's source", async () => {
    // Shared row store so both apps see the same collections.
    const rows: Collections = {
      projects: [{ id: projectId, organizationId: orgA, name: "p", createdAt: "", updatedAt: "" }],
      sources: [],
    };
    const appA = appForOrg(orgA, rows);
    const created = await appA.inject({
      method: "POST",
      url: "/sources",
      payload: { projectId, type: "document", locator: "doc-1" },
    });
    const id = (created.json() as { id: string }).id;
    await appA.close();

    const appB = appForOrg(orgB, rows);
    expect((await appB.inject({ method: "GET", url: `/sources/${id}` })).statusCode).toBe(404);
    expect((await appB.inject({ method: "DELETE", url: `/sources/${id}` })).statusCode).toBe(404);
    await appB.close();
  });
});
