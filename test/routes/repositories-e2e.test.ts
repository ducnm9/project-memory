import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/index.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();
const otherOrgId = newOrgId();
const projectId = newProjectId();

const config = {
  port: 0, host: "0.0.0.0", nodeEnv: "test", logLevel: "silent",
  mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "admin-secret", authTokenPepper: "pepper",
} as AppConfig;

function mockDb(): Db {
  return {
    collection: (name: string) => {
      if (name === "service_tokens") {
        return {
          findOne: vi.fn().mockResolvedValue({
            id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x",
            hashedSecret: "h", createdAt: "", revokedAt: null,
          }),
        };
      }
      if (name === "organizations") {
        return { findOne: vi.fn().mockResolvedValue({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) };
      }
      if (name === "projects") {
        return {
          findOne: vi.fn().mockResolvedValue({
            id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "",
          }),
        };
      }
      if (name === "repositories") {
        return { findOne: vi.fn().mockResolvedValue(null), insertOne: vi.fn().mockResolvedValue({}) };
      }
      return { findOne: vi.fn().mockResolvedValue(null) };
    },
  } as unknown as Db;
}

describe("repository binding end-to-end", () => {
  it("rejects a path-scoped binding request for another org when the header is omitted", async () => {
    const app = buildApp({ config, db: mockDb() });
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
    const app = buildApp({ config, db: mockDb() });
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
});
