import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import type { ProjectContext } from "../modules/project-context/context.js";
import {
  createKnowledgeItemBodySchema,
  knowledgeIdSchema,
  knowledgeStatusSchema,
  knowledgeTypeSchema,
  updateKnowledgeItemBodySchema,
} from "../modules/knowledge-core/entities.js";
import {
  createKnowledgeItemStore,
  type KnowledgeItemFilter,
  type UpdateKnowledgeItemPatch,
} from "../modules/knowledge-core/repository.js";
import { createKnowledgeVersionStore } from "../modules/knowledge-core/version-repository.js";
import { sourceIdSchema } from "../modules/knowledge-core/source-entities.js";
import { createSourceStore } from "../modules/knowledge-core/source-repository.js";
import { validateContent } from "../modules/knowledge-core/contracts.js";
import { assertTransition, isInitialStatus } from "../modules/knowledge-core/lifecycle.js";
import {
  InvalidKnowledgeTypeError,
  InvalidStatusTransitionError,
  InvalidTenantScopeError,
  KnowledgeNotFoundError,
  SourceNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import { createAuditEventStore } from "../modules/governance/audit-repository.js";
import type { AuditEventType } from "../modules/governance/audit-entities.js";
import { SearchIndexer } from "../modules/retrieval/search-indexer.js";
import type { AppConfig } from '../config/index.js';
import { EmbeddingPipeline } from '../modules/retrieval/embedding-pipeline.js';
import { VectorSearchService } from '../modules/retrieval/vector-search.js';
import { HybridRetriever } from '../modules/retrieval/hybrid-retriever.js';
import { Reranker } from '../modules/retrieval/reranker.js';
import { RelationExpander } from '../modules/retrieval/relation-expander.js';
import { ContextAssembler } from '../modules/retrieval/context-assembler.js';
import { ImpactAnalyzer } from '../modules/retrieval/impact-analyzer.js';

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  return ctx;
}

function resolveKnowledgeEventType(
  patch: Record<string, unknown>,
  existing: { status: string },
): AuditEventType {
  const newStatus = patch.status as string | undefined;
  if (newStatus && newStatus !== existing.status) {
    if (newStatus === "ACCEPTED") return "APPROVE";
    if (newStatus === "REJECTED") return "REJECT";
    if (newStatus === "DEPRECATED") return "DEPRECATE";
    if (newStatus === "STALE") return "MARK_STALE";
  }
  if ("lastVerifiedAt" in patch) return "VERIFY";
  return "UPDATE";
}

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(message);
  return result.data as T;
}

export function registerKnowledgeRoutes(app: FastifyInstance, config: AppConfig): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createKnowledgeItemStore(app.db);
  const vStore = () => createKnowledgeVersionStore(app.db);
  const sourceStore = () => createSourceStore(app.db);
  const auditStore = () => createAuditEventStore(app.db);
  const searchIndexer = () => new SearchIndexer(app.db);
  const embeddingPipeline = () =>
    config.embedding ? new EmbeddingPipeline(app.db, config.embedding) : null;
  const vectorSearch = () => new VectorSearchService(app.db, config.embedding);
  const hybridRetriever = () =>
    new HybridRetriever(searchIndexer(), vectorSearch());
  const reranker = () =>
    new Reranker(process.env.COHERE_API_KEY);
  const relationExpander = () => new RelationExpander(app.db);
  const contextAssembler = () => new ContextAssembler(app.db);
  const impactAnalyzer = () => new ImpactAnalyzer(app.db, config.embedding ?? undefined);

  function actorName(actor: { actorId: string; name?: string }): string {
    return actor.name ?? actor.actorId;
  }

  async function requireProject(organizationId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(organizationId, projectId))) throw new TenantNotFoundError();
  }

  // Must be before /knowledge/:id to avoid parametric-route capture
  app.get("/knowledge/ask", BEARER, async (req) => {
    const ctx = context(req);
    const query = req.query as { projectId?: string; question?: string };

    const rawQuestion = (query.question ?? "").trim();
    if (!rawQuestion) throw new ValidationError("question is required");

    const projectId = parseOrThrow(projectIdSchema, query.projectId, "projectId is malformed");
    await requireProject(ctx.organizationId, projectId);

    const candidates = await hybridRetriever().search({
      orgId: ctx.organizationId,
      query: rawQuestion,
      projectId,
    });
    const reranked = await reranker().rerank(rawQuestion, candidates);
    const expanded = await relationExpander().expand(reranked, ctx.organizationId, projectId);
    return contextAssembler().assemble(rawQuestion, expanded, ctx.organizationId, projectId);
  });

  // Must be before /knowledge/:id/... to avoid parametric-route capture
  app.post("/knowledge/embeddings/rebuild", BEARER, async (req) => {
    const ctx = context(req);
    const { projectId: qProjectId } = req.query as { projectId?: string };
    if (!qProjectId) throw new ValidationError("projectId query param required");
    parseOrThrow(projectIdSchema, qProjectId, "projectId is malformed");
    await requireProject(ctx.organizationId, qProjectId);

    const pipeline = embeddingPipeline();
    if (!pipeline) return { queued: 0, reason: "embedding not configured" };

    const items = await store().findByProject(ctx.organizationId, {
      projectId: qProjectId,
      status: "PUBLISHED",
    });
    const toEmbed = items.filter((i) => pipeline.needsReEmbed(i));
    const ids = toEmbed.map((i) => i.id);
    // Fire-and-forget — respond immediately with count
    // ponytail: fire-and-forget embed; replace with a job queue (Bull/BeeQueue)
    // when publish latency or retry reliability becomes a concern
    pipeline.embedBatch(ctx.organizationId, ids).catch((err) =>
      app.log.error({ err }, "embedBatch failed"),
    );
    return { queued: ids.length };
  });

  // Must be before /knowledge/:id/... to avoid parametric-route capture
  app.post("/knowledge/search/rebuild", BEARER, async (req) => {
    const ctx = context(req);
    const { projectId: qProjectId } = req.query as { projectId?: string };
    if (!qProjectId) throw new ValidationError("projectId query param required");
    parseOrThrow(projectIdSchema, qProjectId, "projectId is malformed");
    const items = await store().findByProject(ctx.organizationId, {
      projectId: qProjectId,
      status: "PUBLISHED",
    });
    await searchIndexer().rebuild(ctx.organizationId, qProjectId, items);
    return { rebuilt: items.length };
  });

  app.post("/knowledge", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);

    const raw = (req.body ?? {}) as { type?: unknown; status?: unknown };

    if (raw.type !== undefined && !knowledgeTypeSchema.safeParse(raw.type).success) {
      throw new InvalidKnowledgeTypeError();
    }
    if (raw.status !== undefined) {
      const status = knowledgeStatusSchema.safeParse(raw.status);
      if (!status.success || !isInitialStatus(status.data)) {
        throw new InvalidStatusTransitionError("none", String(raw.status));
      }
    }

    const parsed = createKnowledgeItemBodySchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError("invalid knowledge item body");
    const body = parsed.data;

    if (!projectIdSchema.safeParse(body.projectId).success) {
      throw new ValidationError("projectId is malformed");
    }

    await requireProject(ctx.organizationId, body.projectId);

    const content = validateContent(body.type, body.content);

    const item = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      type: body.type,
      title: body.title,
      summary: body.summary,
      content,
      status: body.status ?? "DISCOVERED",
      ownerId: actor.actorId,
    });
    await vStore().append({
      organizationId: ctx.organizationId,
      knowledgeId: item.id,
      version: item.version,
      snapshot: item,
      changedBy: actor.actorId,
      changeSummary: "initial version",
    });
    await auditStore().append({
      organizationId: ctx.organizationId,
      eventType: "CREATE",
      targetId: item.id,
      targetType: "knowledge",
      actorId: actor.actorId,
      actorName: actorName(actor),
      newVersion: item.version,
    });
    if (item.status === "PUBLISHED") {
      await searchIndexer().upsert(item);
      // ponytail: fire-and-forget embed; replace with a job queue (Bull/BeeQueue)
      // when publish latency or retry reliability becomes a concern
      embeddingPipeline()?.embedItem(ctx.organizationId, item.id).catch((err) =>
        app.log.error({ err, itemId: item.id }, "embed failed on create"),
      );
    }
    reply.status(201);
    return item;
  });

  app.get("/search", BEARER, async (req) => {
    const ctx = context(req);
    const query = req.query as { q?: string; projectId?: string; type?: string; status?: string; limit?: string };

    if (!query.q) throw new ValidationError("q is required");
    const projectId = parseOrThrow(projectIdSchema, query.projectId, "projectId is malformed");
    await requireProject(ctx.organizationId, projectId);

    const results = await hybridRetriever().search({
      orgId: ctx.organizationId,
      query: query.q,
      projectId,
      typeFilter: query.type ? [query.type] : undefined,
      statusFilter: query.status ? [query.status] : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
    });
    return { results, query: query.q, total: results.length };
  });

  app.get('/knowledge/:id/impact', BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    const { projectId: qProjectId } = req.query as { projectId?: string };

    parseOrThrow(knowledgeIdSchema, id, 'knowledge id is malformed');
    const projectId = parseOrThrow(projectIdSchema, qProjectId, 'projectId is malformed');
    await requireProject(ctx.organizationId, projectId);

    const item = await store().findById(ctx.organizationId, id);
    if (!item || item.projectId !== projectId) throw new KnowledgeNotFoundError();

    const impacts = await impactAnalyzer().analyze(ctx.organizationId, projectId, id);
    return { componentId: id, impacts };
  });

  app.get("/knowledge/:id", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();
    return item;
  });

  app.get("/knowledge", BEARER, async (req) => {
    const ctx = context(req);
    const query = req.query as { projectId?: string; type?: string; status?: string };
    const filter: KnowledgeItemFilter = {};

    if (query.projectId !== undefined) {
      const projectId = parseOrThrow(projectIdSchema, query.projectId, "projectId is malformed");
      await requireProject(ctx.organizationId, projectId);
      filter.projectId = projectId;
    }
    if (query.type !== undefined) {
      filter.type = parseOrThrow(knowledgeTypeSchema, query.type, "type filter is invalid");
    }
    if (query.status !== undefined) {
      filter.status = parseOrThrow(knowledgeStatusSchema, query.status, "status filter is invalid");
    }

    return { items: await store().findByProject(ctx.organizationId, filter) };
  });

  app.patch("/knowledge/:id", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const parsed = updateKnowledgeItemBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("invalid knowledge item patch");
    const rawPatch = parsed.data as typeof parsed.data & { changeSummary?: string };
    const callerSummary: string | undefined = rawPatch.changeSummary;
    const patch = { ...rawPatch } as Omit<typeof rawPatch, "changeSummary">;
    delete (patch as Record<string, unknown>).changeSummary;
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("patch must contain at least one field");
    }

    const existing = await store().findById(ctx.organizationId, id);
    if (!existing) throw new KnowledgeNotFoundError();

    if (patch.status !== undefined && patch.status !== existing.status) {
      assertTransition(existing.status, patch.status);
    }

    if (patch.content !== undefined) {
      patch.content = validateContent(existing.type, patch.content);
    }

    const updated = await store().update(ctx.organizationId, id, patch);
    if (!updated) throw new KnowledgeNotFoundError();

    const changedFields = Object.keys(patch).filter((k) => k !== "changeSummary");
    const changeSummary = callerSummary ?? `changed: ${changedFields.join(", ")}`;

    await vStore().append({
      organizationId: ctx.organizationId,
      knowledgeId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: req.actor ? req.actor.actorId : updated.ownerId,
      changeSummary,
    });

    const auditActor = req.actor ?? { actorId: updated.ownerId };
    await auditStore().append({
      organizationId: ctx.organizationId,
      eventType: resolveKnowledgeEventType(patch as Record<string, unknown>, existing),
      targetId: updated.id,
      targetType: "knowledge",
      actorId: auditActor.actorId,
      actorName: actorName(auditActor),
      previousVersion: existing.version,
      newVersion: updated.version,
    });

    if (updated.status === "PUBLISHED" || updated.status === "STALE") {
      await searchIndexer().upsert(updated);
      // ponytail: fire-and-forget embed; replace with a job queue (Bull/BeeQueue)
      // when publish latency or retry reliability becomes a concern
      embeddingPipeline()?.embedItem(ctx.organizationId, updated.id).catch((err) =>
        app.log.error({ err, itemId: updated.id }, "embed failed on update"),
      );
    } else if (updated.status === "DEPRECATED" || updated.status === "REJECTED") {
      await searchIndexer().remove(ctx.organizationId, updated.id);
    }

    return updated;
  });

  app.get("/knowledge/:id/audit", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const events = await auditStore().listByTarget(ctx.organizationId, id);
    return { events };
  });

  app.post("/knowledge/:id/sources", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const body = (req.body ?? {}) as { sourceId?: unknown };
    parseOrThrow(sourceIdSchema, body.sourceId, "sourceId is malformed");
    const sourceId = body.sourceId as string;

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const source = await sourceStore().findById(ctx.organizationId, sourceId);
    if (!source) throw new SourceNotFoundError();

    const current = item.sourceIds ?? [];
    if (current.includes(sourceId)) return item; // idempotent: no bump, no snapshot

    const updated = await store().setSourceIds(ctx.organizationId, id, [...current, sourceId]);
    if (!updated) throw new KnowledgeNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      knowledgeId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `attached source ${sourceId}`,
    });
    return updated;
  });

  app.delete("/knowledge/:id/sources/:sourceId", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);
    const { id, sourceId } = req.params as { id: string; sourceId: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");
    parseOrThrow(sourceIdSchema, sourceId, "sourceId is malformed");

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const current = item.sourceIds ?? [];
    if (!current.includes(sourceId)) throw new SourceNotFoundError();

    const updated = await store().setSourceIds(
      ctx.organizationId,
      id,
      current.filter((s) => s !== sourceId),
    );
    if (!updated) throw new KnowledgeNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      knowledgeId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `detached source ${sourceId}`,
    });
    return updated;
  });

  app.patch("/knowledge/:id/verify", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const now = new Date().toISOString();
    const patch: UpdateKnowledgeItemPatch = { lastVerifiedAt: now };
    if (item.status === "STALE") patch.status = "PUBLISHED";

    const updated = await store().update(ctx.organizationId, id, patch);
    if (!updated) throw new KnowledgeNotFoundError();

    await auditStore().append({
      organizationId: ctx.organizationId,
      eventType: "VERIFY",
      targetId: id,
      targetType: "knowledge",
      actorId: actor.actorId,
      actorName: actorName(actor),
    });
    return updated;
  });

  app.delete("/knowledge/:id", BEARER, async (req, reply) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const removed = await store().delete(ctx.organizationId, id);
    if (!removed) throw new KnowledgeNotFoundError();
    reply.status(204);
    return null;
  });
}
