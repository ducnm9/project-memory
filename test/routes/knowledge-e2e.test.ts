import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/index.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";
import { hashSecret } from "../../src/modules/auth/secret.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = newOrgId();
const otherOrgId = newOrgId();
const projectId = newProjectId();

const config = {
  port: 0, host: "0.0.0.0", nodeEnv: "test", logLevel: "silent",
  mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "admin-secret", authTokenPepper: "pepper",
} as AppConfig;

function seed(): Collections {
  return {
    service_tokens: [{
      id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x",
      hashedSecret: hashSecret("pmk_any", "pepper"), createdAt: "", revokedAt: null,
    }],
    organizations: [{ id: orgId, name: "a", createdAt: "", updatedAt: "" }],
    projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }],
    knowledge_items: [],
  };
}

describe("knowledge end-to-end", () => {
  it("rejects a request scoped to another organization with 403", async () => {
    const { db } = createFakeDb(seed());
    const app = buildApp({ config, db });
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      headers: { authorization: "Bearer pmk_any", "x-organization-id": otherOrgId },
      payload: { projectId, type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });

  it("runs create → get → list → patch → delete within the caller's org", async () => {
    const { db } = createFakeDb(seed());
    const app = buildApp({ config, db });
    const headers = { authorization: "Bearer pmk_any", "x-organization-id": orgId };

    const created = await app.inject({
      method: "POST", url: "/knowledge", headers,
      payload: {
        projectId, type: "Decision", title: "Use AuditLog v2", summary: "Standardized audit schema.",
        content: { context: "c", problem: "p", decision: "d" },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json().status).toBe("DISCOVERED");

    const fetched = await app.inject({ method: "GET", url: `/knowledge/${id}`, headers });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().id).toBe(id);

    const listed = await app.inject({
      method: "GET", url: `/knowledge?projectId=${projectId}&type=Decision`, headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);

    const proposed = await app.inject({
      method: "PATCH", url: `/knowledge/${id}`, headers, payload: { status: "PROPOSED" },
    });
    expect(proposed.statusCode).toBe(200);
    expect(proposed.json().status).toBe("PROPOSED");

    const illegal = await app.inject({
      method: "PATCH", url: `/knowledge/${id}`, headers, payload: { status: "PUBLISHED" },
    });
    expect(illegal.statusCode).toBe(422);
    expect(illegal.json().error.code).toBe("INVALID_STATUS_TRANSITION");

    const removed = await app.inject({ method: "DELETE", url: `/knowledge/${id}`, headers });
    expect(removed.statusCode).toBe(204);

    const afterDelete = await app.inject({ method: "GET", url: `/knowledge/${id}`, headers });
    expect(afterDelete.statusCode).toBe(404);
    expect(afterDelete.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");

    await app.close();
  });

  it("returns 400 when the organization header is omitted", async () => {
    const { db } = createFakeDb(seed());
    const app = buildApp({ config, db });
    const res = await app.inject({
      method: "POST", url: "/knowledge",
      headers: { authorization: "Bearer pmk_any" },
      payload: { projectId, type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TENANT_SCOPE");
    await app.close();
  });
});
