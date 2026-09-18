import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/index.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";
import { hashSecret } from "../../src/modules/auth/secret.js";

const orgId = newOrgId();
const otherOrgId = newOrgId();
const projectId = newProjectId();

const config = {
  port: 0, host: "0.0.0.0", nodeEnv: "test", logLevel: "silent",
  mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "admin-secret", authTokenPepper: "pepper",
} as AppConfig;

type Row = Record<string, unknown>;

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([k, v]) => row[k] === v);
}

function memoryDb(): Db {
  const rows: Record<string, Row[]> = {
    service_tokens: [
      { id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x", hashedSecret: hashSecret("pmk_any", "pepper"), createdAt: "", revokedAt: null },
    ],
    organizations: [{ id: orgId, name: "a", createdAt: "", updatedAt: "" }],
    projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }],
    repositories: [],
  };
  return {
    collection: (name: string) => {
      const list = (rows[name] ??= []);
      return {
        findOne: async (filter: Row) => list.find((r) => matches(r, filter)) ?? null,
        insertOne: async (doc: Row) => {
          list.push(doc);
          return {};
        },
        find: (filter: Row) => ({ toArray: async () => list.filter((r) => matches(r, filter)) }),
        updateOne: async (filter: Row, update: { $set: Row }) => {
          const row = list.find((r) => matches(r, filter));
          if (!row) return { matchedCount: 0 };
          Object.assign(row, update.$set);
          return { matchedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

describe("repository binding end-to-end", () => {
  it("rejects a path-scoped binding request for another org when the header is omitted", async () => {
    const app = buildApp({ config, db: memoryDb() });
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${otherOrgId}/projects/${projectId}/repositories`,
      headers: { authorization: "Bearer pmk_any" },
      payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });

  it("binds a repository inside the caller's own org", async () => {
    const app = buildApp({ config, db: memoryDb() });
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/repositories`,
      headers: { authorization: "Bearer pmk_any" },
      payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^repo_/);
    await app.close();
  });

  it("connect → resolve → unbind → resolve → re-bind", async () => {
    const app = buildApp({ config, db: memoryDb() });
    const auth = { authorization: "Bearer pmk_any" };
    const collectionUrl = `/organizations/${orgId}/projects/${projectId}/repositories`;
    const resolveUrl = (raw: string) =>
      `/organizations/${orgId}/repositories/resolve?repositoryUrl=${encodeURIComponent(raw)}`;

    const connect = await app.inject({
      method: "POST", url: collectionUrl, headers: auth,
      payload: { repositoryUrl: "https://github.com/acme/widgets.git" },
    });
    expect(connect.statusCode).toBe(201);
    const repositoryId = connect.json().id;

    const resolved = await app.inject({ method: "GET", url: resolveUrl("https://github.com/acme/widgets"), headers: auth });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toEqual({ organizationId: orgId, projectId, repositoryId });

    const unbound = await app.inject({ method: "DELETE", url: `${collectionUrl}/${repositoryId}`, headers: auth });
    expect(unbound.statusCode).toBe(204);

    const afterUnbind = await app.inject({ method: "GET", url: resolveUrl("https://github.com/acme/widgets"), headers: auth });
    expect(afterUnbind.statusCode).toBe(404);
    expect(afterUnbind.json().error.code).toBe("REPOSITORY_NOT_FOUND");

    const rebound = await app.inject({
      method: "POST", url: collectionUrl, headers: auth,
      payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(rebound.statusCode).toBe(201);
    expect(rebound.json().id).not.toBe(repositoryId);

    await app.close();
  });
});
