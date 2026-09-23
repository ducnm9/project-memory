import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect } from "vitest";
import { registerBootstrapRoutes } from "../../src/routes/bootstrap.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";
import { newRepositoryId } from "../../src/modules/repository-binding/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = newOrgId();
const projectId = newProjectId();
const repoId = newRepositoryId();

function buildApp(rows: Collections): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const r = req as unknown as Record<string, unknown>;
    r.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    r.projectContext = { organizationId: orgId, projectId: null };
  });
  app.decorate("config", { llm: null });
  registerErrorHandler(app);
  registerBootstrapRoutes(app);
  return app;
}

const seeded = (extra: Collections = {}): Collections => ({
  projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }],
  repositories: [{
    id: repoId, organizationId: orgId, projectId,
    url: "https://github.com/test/repo", host: "github.com", path: "test/repo",
    connector: "github", defaultBranch: "main", createdAt: "", createdBy: "tok_1", unboundAt: null,
    lastCommitSha: null, lastSyncedAt: null,
  }],
  project_snapshots: [],
  proposals: [],
  ...extra,
});

describe("POST /organizations/:orgId/projects/:projectId/bootstrap", () => {
  it("returns 404 when project does not exist", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${newProjectId()}/bootstrap`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 404 when no repository is bound", async () => {
    const app = buildApp({ projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }], repositories: [], project_snapshots: [], proposals: [] });
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/bootstrap`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /organizations/:orgId/projects/:projectId/snapshot", () => {
  it("returns 404 when no snapshot exists", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${orgId}/projects/${projectId}/snapshot`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
