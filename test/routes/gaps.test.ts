import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerGapRoutes } from "../../src/routes/gaps.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";
import { newGapId } from "../../src/modules/knowledge-core/gap-entities.js";
import { createGapStore } from "../../src/modules/knowledge-core/gap-repository.js";

const orgId = "org_A";
const projectId = newProjectId();

function makeGap(overrides: Record<string, unknown> = {}) {
  return {
    id: newGapId(),
    organizationId: orgId,
    projectId,
    question: "how does auth work?",
    occurrenceCount: 1,
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    attemptedSearches: [{ searchedAt: "2026-01-01T00:00:00.000Z", query: "how does auth work?" }],
    relatedKnowledgeIds: [],
    ownerId: null,
    status: "OPEN",
    ...overrides,
  };
}

const seeded = (): Collections => ({ knowledge_gaps: [] });

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
  registerGapRoutes(app);
  return app;
}

describe("GET /gaps", () => {
  it("returns gaps sorted by occurrenceCount desc", async () => {
    const gap1 = makeGap({ question: "q1", occurrenceCount: 2 });
    const gap2 = makeGap({ question: "q2", occurrenceCount: 5 });
    const app = buildApp({ knowledge_gaps: [gap1, gap2] });
    const res = await app.inject({ method: "GET", url: `/gaps?projectId=${projectId}` });
    expect(res.statusCode).toBe(200);
    const { gaps } = res.json() as { gaps: { occurrenceCount: number }[] };
    expect(gaps).toHaveLength(2);
    expect(gaps[0].occurrenceCount).toBe(5);
    expect(gaps[1].occurrenceCount).toBe(2);
    await app.close();
  });

  it("filters by status", async () => {
    const open = makeGap({ question: "q1", status: "OPEN" });
    const resolved = makeGap({ question: "q2", status: "RESOLVED" });
    const app = buildApp({ knowledge_gaps: [open, resolved] });
    const res = await app.inject({
      method: "GET",
      url: `/gaps?projectId=${projectId}&status=OPEN`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { gaps: unknown[] }).gaps).toHaveLength(1);
    await app.close();
  });

  it("400 when projectId is missing", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: "/gaps" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /gaps/:id", () => {
  it("returns the gap", async () => {
    const gap = makeGap();
    const app = buildApp({ knowledge_gaps: [gap] });
    const res = await app.inject({ method: "GET", url: `/gaps/${gap.id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { id: string }).id).toBe(gap.id as string);
    await app.close();
  });

  it("404 for a missing gap", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: `/gaps/${newGapId()}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /gaps/:id", () => {
  it("updates ownerId and status", async () => {
    const gap = makeGap();
    const app = buildApp({ knowledge_gaps: [gap] });
    const res = await app.inject({
      method: "PATCH",
      url: `/gaps/${gap.id}`,
      payload: { status: "IN_PROGRESS", ownerId: "user_1" },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as { status: string; ownerId: string };
    expect(updated.status).toBe("IN_PROGRESS");
    expect(updated.ownerId).toBe("user_1");
    await app.close();
  });

  it("updates relatedKnowledgeIds", async () => {
    const gap = makeGap();
    const app = buildApp({ knowledge_gaps: [gap] });
    const res = await app.inject({
      method: "PATCH",
      url: `/gaps/${gap.id}`,
      payload: { relatedKnowledgeIds: ["know_01ARZ3NDEKTSV4RRFFQ69G5FAV"] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { relatedKnowledgeIds: string[] }).relatedKnowledgeIds).toEqual([
      "know_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    ]);
    await app.close();
  });

  it("404 for a missing gap", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "PATCH",
      url: `/gaps/${newGapId()}`,
      payload: { status: "RESOLVED" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("400 for an invalid status value", async () => {
    const gap = makeGap();
    const app = buildApp({ knowledge_gaps: [gap] });
    const res = await app.inject({
      method: "PATCH",
      url: `/gaps/${gap.id}`,
      payload: { status: "BOGUS" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("upsertOnQuestion", () => {
  it("creates a new gap on first call", async () => {
    const { db } = createFakeDb({ knowledge_gaps: [] });
    const store = createGapStore(db);
    const gap = await store.upsertOnQuestion(orgId, projectId, "what is caching?");
    expect(gap.id).toMatch(/^gap_/);
    expect(gap.occurrenceCount).toBe(1);
    expect(gap.status).toBe("OPEN");
    expect(gap.ownerId).toBeNull();
    expect(gap.attemptedSearches).toHaveLength(1);
    expect(gap.relatedKnowledgeIds).toEqual([]);
  });

  it("increments occurrenceCount on repeated question", async () => {
    const { db } = createFakeDb({ knowledge_gaps: [] });
    const store = createGapStore(db);
    const first = await store.upsertOnQuestion(orgId, projectId, "what is caching?");
    const second = await store.upsertOnQuestion(orgId, projectId, "what is caching?");
    expect(second.id).toBe(first.id);
    expect(second.occurrenceCount).toBe(2);
    expect(second.attemptedSearches).toHaveLength(2);
  });
});
