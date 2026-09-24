import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newKnowledgeItemId } from "../../src/modules/knowledge-core/entities.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";
import type { KnowledgeVersion } from "../../src/modules/knowledge-core/version-entities.js";

const versionsOf = (rows: Collections): KnowledgeVersion[] =>
  (rows.knowledge_versions ?? []) as unknown as KnowledgeVersion[];

const orgId = "org_A";
const projectId = newProjectId();
const unknownProjectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

function buildApp(rows: Collections, withContext = true): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    enriched.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    if (withContext) enriched.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerKnowledgeRoutes(app, { embedding: null } as import("../../src/config/index.js").AppConfig);
  return app;
}

const seeded = (extra: Collections = {}): Collections => ({ projects: [project], knowledge_items: [], ...extra });

describe("POST /knowledge", () => {
  it("creates a 201 item with defaults and server-derived owner", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: {
        projectId, type: "Decision", title: "t", summary: "s",
        content: { context: "c", problem: "p", decision: "d" },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body._id).toBeUndefined();
    expect(body.id).toMatch(/^know_/);
    expect(body.status).toBe("DISCOVERED");
    expect(body.content).toEqual({ context: "c", problem: "p", decision: "d" });
    expect(body.ownerId).toBe("tok_1");
    expect(body.organizationId).toBe(orgId);
    await app.close();
  });

  it("accepts PROPOSED as an explicit initial status", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s", status: "PROPOSED", content: { context: "c", problem: "p", decision: "d" } },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("PROPOSED");
    await app.close();
  });

  it("rejects an unknown type with 422", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Bogus", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_KNOWLEDGE_TYPE");
    await app.close();
  });

  it("rejects a non-initial status with 422", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s", status: "ACCEPTED", content: { context: "c", problem: "p", decision: "d" } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_STATUS_TRANSITION");
    await app.close();
  });

  it("rejects a missing projectId with 400", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("returns 404 for a project outside the org", async () => {
    const app = buildApp({ projects: [], knowledge_items: [] });
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s", content: { context: "c", problem: "p", decision: "d" } },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TENANT_NOT_FOUND");
    await app.close();
  });

  it("rejects a missing type with 400", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects a malformed projectId with 400", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId: "not-a-project", type: "Decision", title: "t", summary: "s", content: { context: "c", problem: "p", decision: "d" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("returns 400 when there is no organization context", async () => {
    const app = buildApp(seeded(), false);
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s", content: { context: "c", problem: "p", decision: "d" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TENANT_SCOPE");
    await app.close();
  });

  it("rejects content that violates its type contract with 400", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: {
        projectId, type: "Decision", title: "t", summary: "s",
        content: { context: "c" },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("creates a valid Concept with 201", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: {
        projectId, type: "Concept", title: "t", summary: "s",
        content: { definition: "d" },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("Concept");
    expect(res.json().content).toEqual({ definition: "d" });
    await app.close();
  });

  it("rejects an empty content object for a type that requires fields", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s", content: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

describe("GET /knowledge/:id", () => {
  it("returns an in-org item, 404 for missing, 400 for a malformed id", async () => {
    const item = {
      id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
      title: "t", summary: "s", content: {}, status: "DISCOVERED", version: 1,
      ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
    };
    const app = buildApp({ projects: [project], knowledge_items: [item] });

    const ok = await app.inject({ method: "GET", url: `/knowledge/${item.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toBe(item.id);

    const missing = await app.inject({ method: "GET", url: `/knowledge/${newKnowledgeItemId()}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");

    const malformed = await app.inject({ method: "GET", url: "/knowledge/not-an-id" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

describe("GET /knowledge", () => {
  it("lists with project, type and status filters", async () => {
    const make = (over: Record<string, unknown>) => ({
      id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
      title: "t", summary: "s", content: {}, status: "DISCOVERED", version: 1,
      ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null, ...over,
    });
    const app = buildApp({
      projects: [project],
      knowledge_items: [make({}), make({ type: "Concept", status: "PROPOSED" })],
    });

    const all = await app.inject({ method: "GET", url: `/knowledge?projectId=${projectId}` });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(2);

    const concept = await app.inject({ method: "GET", url: "/knowledge?type=Concept" });
    expect(concept.json().items).toHaveLength(1);

    const proposed = await app.inject({ method: "GET", url: "/knowledge?status=PROPOSED" });
    expect(proposed.json().items).toHaveLength(1);

    const badType = await app.inject({ method: "GET", url: "/knowledge?type=Bogus" });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().error.code).toBe("VALIDATION_ERROR");

    const unknownProject = await app.inject({ method: "GET", url: `/knowledge?projectId=${unknownProjectId}` });
    expect(unknownProject.statusCode).toBe(404);
    expect(unknownProject.json().error.code).toBe("TENANT_NOT_FOUND");
    await app.close();
  });

  it("rejects a malformed projectId filter with 400", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: "/knowledge?projectId=not-a-project" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("rejects a bad status filter with 400", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: "/knowledge?status=BOGUS" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

describe("PATCH /knowledge/:id", () => {
  const published = {
    id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
    title: "t", summary: "s", content: {}, status: "PUBLISHED", version: 1,
    ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
  };

  it("updates a field and returns the item", async () => {
    const item = { ...published, status: "DISCOVERED" };
    const app = buildApp({ projects: [project], knowledge_items: [item] });
    const res = await app.inject({
      method: "PATCH", url: `/knowledge/${item.id}`, payload: { title: "New" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("New");
    await app.close();
  });

  it("applies a legal status transition and rejects an illegal one", async () => {
    const app = buildApp({ projects: [project], knowledge_items: [{ ...published, status: "PROPOSED" }] });
    const id = published.id;

    const legal = await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { status: "VALIDATING" } });
    expect(legal.statusCode).toBe(200);
    expect(legal.json().status).toBe("VALIDATING");

    const illegal = await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { status: "DISCOVERED" } });
    expect(illegal.statusCode).toBe(422);
    expect(illegal.json().error.code).toBe("INVALID_STATUS_TRANSITION");
    await app.close();
  });

  it("rejects an empty patch and immutable fields with 400", async () => {
    const app = buildApp({ projects: [project], knowledge_items: [{ ...published, status: "DISCOVERED" }] });
    const id = published.id;

    const empty = await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: {} });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("VALIDATION_ERROR");

    const immutable = await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { type: "Concept" } });
    expect(immutable.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 when patching an item in another organization", async () => {
    const foreign = { ...published, organizationId: "org_B", status: "DISCOVERED" };
    const app = buildApp({ projects: [project], knowledge_items: [foreign] });
    const res = await app.inject({
      method: "PATCH", url: `/knowledge/${foreign.id}`, payload: { title: "x" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");
    await app.close();
  });

  it("treats a same-status patch as a no-op and returns 200", async () => {
    const item = { ...published, status: "DISCOVERED" };
    const app = buildApp({ projects: [project], knowledge_items: [item] });
    const res = await app.inject({
      method: "PATCH", url: `/knowledge/${item.id}`, payload: { status: "DISCOVERED" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("DISCOVERED");
    await app.close();
  });

  it("returns 404 for a missing item", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "PATCH", url: `/knowledge/${newKnowledgeItemId()}`, payload: { title: "x" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");
    await app.close();
  });

  it("validates replacement content against the item's existing type", async () => {
    const item = { ...published, status: "DISCOVERED", content: { context: "c", problem: "p", decision: "d" } };
    const app = buildApp({ projects: [project], knowledge_items: [item] });
    const res = await app.inject({
      method: "PATCH",
      url: `/knowledge/${item.id}`,
      payload: { content: { context: "only-context" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("accepts valid replacement content and returns it", async () => {
    const item = { ...published, status: "DISCOVERED", content: { context: "c", problem: "p", decision: "d" } };
    const app = buildApp({ projects: [project], knowledge_items: [item] });
    const next = { context: "c2", problem: "p2", decision: "d2" };
    const res = await app.inject({
      method: "PATCH",
      url: `/knowledge/${item.id}`,
      payload: { content: next },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toEqual(next);
    await app.close();
  });
});

describe("DELETE /knowledge/:id", () => {
  it("deletes an in-org item and 404s for a missing one", async () => {
    const item = {
      id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
      title: "t", summary: "s", content: {}, status: "DISCOVERED", version: 1,
      ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
    };
    const app = buildApp({ projects: [project], knowledge_items: [item] });

    const gone = await app.inject({ method: "DELETE", url: `/knowledge/${item.id}` });
    expect(gone.statusCode).toBe(204);

    const again = await app.inject({ method: "DELETE", url: `/knowledge/${item.id}` });
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");
    await app.close();
  });

  it("cannot delete an item in another organization", async () => {
    const foreign = {
      id: newKnowledgeItemId(), organizationId: "org_B", projectId, type: "Decision",
      title: "t", summary: "s", content: {}, status: "DISCOVERED", version: 1,
      ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
    };
    const app = buildApp({ projects: [project], knowledge_items: [foreign] });
    const res = await app.inject({ method: "DELETE", url: `/knowledge/${foreign.id}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("versioning — POST /knowledge writes v1", () => {
  it("creates version 1 with changeSummary 'initial version' after POST", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: {
        projectId,
        type: "Concept",
        title: "t",
        summary: "s",
        content: { definition: "d" },
      },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json();
    expect(item.version).toBe(1);
    const versions = versionsOf(rows);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].changeSummary).toBe("initial version");
    expect(versions[0].knowledgeId).toBe(item.id);
    await app.close();
  });
});

describe("versioning — PATCH /knowledge/:id writes snapshots", () => {
  it("after 3 patches there are 4 version records (v1 + 3)", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: { projectId, type: "Concept", title: "t", summary: "s", content: { definition: "d" } },
    })).json();
    const id = created.id;
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "t2" } });
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "t3" } });
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "t4" } });

    const versions = versionsOf(rows);
    expect(versions).toHaveLength(4);
    const versionNums = versions.map((v) => v.version).sort((a, b) => a - b);
    expect(versionNums).toEqual([1, 2, 3, 4]);
    await app.close();
  });

  it("caller-provided changeSummary is stored verbatim", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: { projectId, type: "Concept", title: "t", summary: "s", content: { definition: "d" } },
    })).json();
    await app.inject({
      method: "PATCH",
      url: `/knowledge/${created.id}`,
      payload: { title: "t2", changeSummary: "my note" },
    });
    const v2 = versionsOf(rows).find((v) => v.version === 2);
    expect(v2?.changeSummary).toBe("my note");
    await app.close();
  });

  it("auto-generates changeSummary from changed fields when not provided", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: { projectId, type: "Concept", title: "t", summary: "s", content: { definition: "d" } },
    })).json();
    await app.inject({
      method: "PATCH",
      url: `/knowledge/${created.id}`,
      payload: { title: "t2", summary: "s2" },
    });
    const v2 = versionsOf(rows).find((v) => v.version === 2);
    expect(v2?.changeSummary).toBe("changed: title, summary");
    await app.close();
  });

  it("changeSummary is not stored on the KnowledgeItem itself", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: { projectId, type: "Concept", title: "t", summary: "s", content: { definition: "d" } },
    })).json();
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/knowledge/${created.id}`,
      payload: { title: "t2", changeSummary: "my note" },
    });
    expect(patchRes.json().changeSummary).toBeUndefined();
    await app.close();
  });
});
