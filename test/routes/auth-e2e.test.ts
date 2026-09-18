import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/index.js";
import { newOrgId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();
const config = {
  port: 0, host: "0.0.0.0", nodeEnv: "test", logLevel: "silent",
  mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "admin-secret", authTokenPepper: "pepper",
} as AppConfig;

// A token bound to orgId, active. Any hash lookup returns it.
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
      return { findOne: vi.fn().mockResolvedValue(null) };
    },
  } as unknown as Db;
}

describe("auth end-to-end", () => {
  it("no bearer → 401 on a bearer route", async () => {
    const app = buildApp({ config, db: mockDb() });
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}`, headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("bearer + matching org → 200", async () => {
    const app = buildApp({ config, db: mockDb() });
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${orgId}`,
      headers: { authorization: "Bearer pmk_any", "x-organization-id": orgId },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("bearer + mismatched org header → 403", async () => {
    const other = newOrgId();
    const app = buildApp({ config, db: mockDb() });
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${orgId}`,
      headers: { authorization: "Bearer pmk_any", "x-organization-id": other },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });
});
