import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { registerRepositoryRoutes } from "../../src/routes/repositories.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";
import { newRepositoryId } from "../../src/modules/repository-binding/entities.js";

const orgId = newOrgId();
const projectId = newProjectId();
const repositoryId = newRepositoryId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };
const collectionUrl = `/organizations/${orgId}/projects/${projectId}/repositories`;

function buildApp(handlers: Record<string, Record<string, unknown>>): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = { collection: (n: string) => handlers[n] ?? {} } as unknown as Db;
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { actor: unknown }).actor = {
      actorId: "tok_1", organizationId: orgId, type: "service",
    };
  });
  registerErrorHandler(app);
  registerRepositoryRoutes(app);
  return app;
}

describe("POST .../repositories", () => {
  it("binds a repository and returns 201 with the canonical url", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: { findOne: vi.fn().mockResolvedValue(null), insertOne },
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl,
      payload: { repositoryUrl: "https://github.com/acme/widgets.git" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^repo_/);
    expect(res.json().url).toBe("https://github.com/acme/widgets");
    expect(res.json().projectId).toBe(projectId);
    expect(res.json().createdBy).toBe("tok_1");
    await app.close();
  });

  it("is idempotent (200) when the same url is already bound to the same project", async () => {
    const existing = {
      id: repositoryId, organizationId: orgId, projectId,
      url: "https://github.com/acme/widgets", host: "github.com", path: "acme/widgets",
      connector: "github", defaultBranch: null, createdAt: "", createdBy: "tok_1", unboundAt: null,
    };
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: { findOne: vi.fn().mockResolvedValue(existing), insertOne: vi.fn() },
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(repositoryId);
    await app.close();
  });

  it("returns 409 when the same url is bound to a different project", async () => {
    const existing = {
      id: repositoryId, organizationId: orgId, projectId: newProjectId(),
      url: "https://github.com/acme/widgets", unboundAt: null,
    };
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: { findOne: vi.fn().mockResolvedValue(existing), insertOne: vi.fn() },
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REPOSITORY_ALREADY_BOUND");
    await app.close();
  });

  it("returns 400 INVALID_REPOSITORY_URL for a malformed url", async () => {
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: {},
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "not a url" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REPOSITORY_URL");
    await app.close();
  });

  it("returns 404 when the project does not exist in the org", async () => {
    const app = buildApp({ projects: { findOne: vi.fn().mockResolvedValue(null) }, repositories: {} });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TENANT_NOT_FOUND");
    await app.close();
  });

  it("maps a duplicate-key race onto the idempotent branch", async () => {
    const existing = {
      id: repositoryId, organizationId: orgId, projectId,
      url: "https://github.com/acme/widgets", unboundAt: null,
    };
    const dup = Object.assign(new Error("duplicate"), { code: 11000 });
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: {
        findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
        insertOne: vi.fn().mockRejectedValue(dup),
      },
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(repositoryId);
    await app.close();
  });
});

describe("GET .../repositories", () => {
  it("lists active bindings for the project", async () => {
    const toArray = vi.fn().mockResolvedValue([{ id: repositoryId, projectId }]);
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: { find: vi.fn().mockReturnValue({ toArray }) },
    });
    const res = await app.inject({ method: "GET", url: collectionUrl });
    expect(res.statusCode).toBe(200);
    expect(res.json().repositories).toHaveLength(1);
    await app.close();
  });
});

describe("GET /organizations/:orgId/repositories/resolve", () => {
  const resolveUrl = (raw: string) =>
    `/organizations/${orgId}/repositories/resolve?repositoryUrl=${encodeURIComponent(raw)}`;

  it("returns the project for a bound repository", async () => {
    const app = buildApp({ repositories: { findOne: vi.fn().mockResolvedValue({ id: repositoryId, projectId }) } });
    const res = await app.inject({ method: "GET", url: resolveUrl("https://github.com/acme/widgets.git") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ organizationId: orgId, projectId, repositoryId });
    await app.close();
  });

  it("returns 404 when the repository is not bound", async () => {
    const app = buildApp({ repositories: { findOne: vi.fn().mockResolvedValue(null) } });
    const res = await app.inject({ method: "GET", url: resolveUrl("https://github.com/acme/widgets") });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("REPOSITORY_NOT_FOUND");
    await app.close();
  });

  it("returns 400 for a malformed repository url", async () => {
    const app = buildApp({ repositories: {} });
    const res = await app.inject({ method: "GET", url: resolveUrl("nope") });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REPOSITORY_URL");
    await app.close();
  });
});

describe("DELETE .../repositories/:repositoryId", () => {
  it("soft-unbinds and returns 204", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const app = buildApp({ repositories: { updateOne } });
    const res = await app.inject({ method: "DELETE", url: `${collectionUrl}/${repositoryId}` });
    expect(res.statusCode).toBe(204);
    expect(updateOne).toHaveBeenCalledWith(
      { id: repositoryId, organizationId: orgId, projectId, unboundAt: null },
      { $set: { unboundAt: expect.any(String) } },
    );
    await app.close();
  });

  it("returns 404 when no active binding matched", async () => {
    const app = buildApp({ repositories: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) } });
    const res = await app.inject({ method: "DELETE", url: `${collectionUrl}/${repositoryId}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("REPOSITORY_NOT_FOUND");
    await app.close();
  });
});
