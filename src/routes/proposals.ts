import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/index.js";
import { createProposalStore } from "../modules/governance/proposal-store.js";
import { createConflictStore } from "../modules/governance/conflict-store.js";
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createAuditEventStore } from "../modules/governance/audit-repository.js";
import { SearchIndexer } from "../modules/retrieval/search-indexer.js";
import { DuplicateDetector } from "../modules/governance/duplicate-detector.js";
import { ContradictionDetector } from "../modules/governance/contradiction-detector.js";
import { requireRole } from "../modules/auth/actor.js";
import { orgIdSchema, projectIdSchema } from "../modules/project-context/entities.js";
import { knowledgeTypeSchema } from "../modules/knowledge-core/entities.js";
import { sourceIdSchema } from "../modules/knowledge-core/source-entities.js";
import { PROPOSAL_STATUSES } from "../modules/governance/proposal-entities.js";
import { z } from "zod";
import {
  DuplicateProposalError,
  ForbiddenScopeError,
  InvalidStatusTransitionError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import type { ValidationResult } from "../modules/governance/proposal-entities.js";

const proposalIdSchema = z.string().regex(/^prop_[0-9A-HJKMNP-TV-Z]{26}$/);
const nonEmpty = (msg = "required") => z.string().trim().min(1, msg);

const createProposalBodySchema = z.object({
  type: knowledgeTypeSchema,
  title: nonEmpty(),
  summary: nonEmpty(),
  content: z.record(z.unknown()).default({}),
  sourceIds: z.array(sourceIdSchema).default([]),
  triggeredBy: z.enum(["bootstrap", "incremental", "manual"]).default("manual"),
  knowledgeItemId: z.string().nullable().default(null),
}).strict();

const approveBodySchema = z.object({
  content: z.record(z.unknown()).optional(),
}).strict();

const rejectBodySchema = z.object({ reason: nonEmpty("reason is required") }).strict();
const requestChangesBodySchema = z.object({ feedback: nonEmpty("feedback is required") }).strict();
const bulkApproveBodySchema = z.object({ ids: z.array(proposalIdSchema).min(1) }).strict();
const bulkRejectBodySchema = z.object({ ids: z.array(proposalIdSchema).min(1), reason: nonEmpty() }).strict();

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } },
  value: unknown,
  message: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const detail = r.error?.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ValidationError(detail ?? message);
  }
  return r.data as T;
}

export function registerProposalRoutes(app: FastifyInstance, config: AppConfig): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.post("/organizations/:orgId/projects/:projectId/proposals", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    parseOrThrow(projectIdSchema, projectId, "project id is malformed");
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");

    const body = parseOrThrow(createProposalBodySchema, req.body ?? {}, "invalid body");

    const validationResults: ValidationResult[] = [];

    const dupDetector = new DuplicateDetector(app.db, config.embedding ?? undefined);
    const dupResult = await dupDetector.detect(orgId, projectId, body.type, body.title, body.summary, body.sourceIds);
    if (dupResult?.duplicate) throw new DuplicateProposalError(`duplicate: ${dupResult.existingId} (${dupResult.reason})`);
    if (dupResult) validationResults.push({ checkType: "duplicate", status: "WARN", message: `similar to ${dupResult.existingId}`, details: dupResult });

    const contraDetector = new ContradictionDetector(app.db, config.llm ?? undefined, config.embedding ?? undefined);
    const contradictions = await contraDetector.detect(orgId, projectId, body.type, body.title, body.summary, body.content);

    const store = createProposalStore(app.db);
    const proposal = await store.create({
      organizationId: orgId, projectId, type: body.type, title: body.title,
      summary: body.summary, content: body.content, sourceIds: body.sourceIds,
      triggeredBy: body.triggeredBy, proposedBy: actor.actorId,
      knowledgeItemId: body.knowledgeItemId, validationResults,
    });

    const conflictRecords = [];
    if (contradictions.length > 0) {
      const conflictStore = createConflictStore(app.db);
      for (const c of contradictions) {
        const cr = await conflictStore.create({
          organizationId: orgId, projectId, proposalId: proposal.id,
          conflictingKnowledgeId: c.conflictingId,
          explanation: c.explanation,
        });
        conflictRecords.push(cr);
      }
    }

    reply.status(201);
    return { proposal, conflictRecords };
  });

  app.get("/organizations/:orgId/projects/:projectId/proposals", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const { status, limit: limitStr, offset: offsetStr } = req.query as { status?: string; limit?: string; offset?: string };
    let statusFilter: (typeof PROPOSAL_STATUSES)[number] | undefined;
    if (status) {
      const r = z.enum(PROPOSAL_STATUSES).safeParse(status);
      if (!r.success) throw new ValidationError("invalid status");
      statusFilter = r.data;
    }
    const limit = limitStr ? Math.min(parseInt(limitStr, 10) || 50, 100) : 50;
    const offset = offsetStr ? parseInt(offsetStr, 10) || 0 : 0;
    const store = createProposalStore(app.db);
    const proposals = await store.findByProject(orgId, projectId, { status: statusFilter, limit, offset });
    return { proposals, total: proposals.length };
  });

  app.get("/organizations/:orgId/projects/:projectId/proposals/:id", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
    parseOrThrow(proposalIdSchema, id, "proposal id is malformed");
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const store = createProposalStore(app.db);
    const proposal = await store.findById(orgId, id);
    if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
    const conflictStore = createConflictStore(app.db);
    const conflictRecords = await conflictStore.findByProposal(orgId, id);
    return { ...proposal, conflictRecords };
  });

  // Bulk routes registered BEFORE /:id routes to avoid Fastify treating "bulk-approve"/"bulk-reject" as an id param
  app.post("/organizations/:orgId/projects/:projectId/proposals/bulk-approve", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const { ids } = parseOrThrow(bulkApproveBodySchema, req.body ?? {}, "ids required");

    const proposalStore = createProposalStore(app.db);
    // Validate all before modifying any (all-or-none semantics)
    const proposals = await Promise.all(ids.map(id => proposalStore.findById(orgId, id)));
    for (const p of proposals) {
      if (!p || p.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (p.status !== "VALIDATING") throw new InvalidStatusTransitionError(p.status, "PUBLISHED");
    }

    const knowledgeStore = createKnowledgeItemStore(app.db);
    const results = [];
    for (const p of proposals) {
      if (!p) continue;
      const item = await knowledgeStore.create({
        organizationId: orgId, projectId, type: p.type,
        title: p.title, summary: p.summary, content: p.content,
        status: "PUBLISHED", ownerId: p.proposedBy,
      });
      await new SearchIndexer(app.db).upsert(item);
      await proposalStore.approve(orgId, p.id, actor.actorId, item.id);
      await createAuditEventStore(app.db).append({
        organizationId: orgId, eventType: "APPROVE",
        targetId: item.id, targetType: "knowledge",
        actorId: actor.actorId, actorName: actor.actorId,
      });
      results.push({ id: p.id, status: "approved", knowledgeItemId: item.id });
    }
    reply.status(207);
    return { results };
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/bulk-reject", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const { ids, reason } = parseOrThrow(bulkRejectBodySchema, req.body ?? {}, "ids and reason required");

    const proposalStore = createProposalStore(app.db);
    const proposals = await Promise.all(ids.map(id => proposalStore.findById(orgId, id)));
    for (const p of proposals) {
      if (!p || p.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (p.status !== "VALIDATING") throw new InvalidStatusTransitionError(p.status, "REJECTED");
    }

    const results = [];
    for (const p of proposals) {
      if (!p) continue;
      await proposalStore.reject(orgId, p.id, actor.actorId, reason);
      await createAuditEventStore(app.db).append({
        organizationId: orgId, eventType: "REJECT",
        targetId: p.id, targetType: "knowledge",
        actorId: actor.actorId, actorName: actor.actorId, reason,
      });
      results.push({ id: p.id, status: "rejected" });
    }
    reply.status(207);
    return { results };
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/:id/approve", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    parseOrThrow(proposalIdSchema, id, "proposal id is malformed");
    const body = parseOrThrow(approveBodySchema, req.body ?? {}, "invalid approve body");

    const proposalStore = createProposalStore(app.db);
    const proposal = await proposalStore.findById(orgId, id);
    if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
    if (proposal.status !== "VALIDATING") throw new InvalidStatusTransitionError(proposal.status, "PUBLISHED");

    const finalContent = body.content ?? proposal.content;
    const knowledgeStore = createKnowledgeItemStore(app.db);

    let knowledgeItem;
    if (proposal.knowledgeItemId) {
      knowledgeItem = await knowledgeStore.update(orgId, proposal.knowledgeItemId, {
        title: proposal.title, summary: proposal.summary, content: finalContent, status: "PUBLISHED",
      });
    } else {
      knowledgeItem = await knowledgeStore.create({
        organizationId: orgId, projectId, type: proposal.type,
        title: proposal.title, summary: proposal.summary, content: finalContent,
        status: "PUBLISHED", ownerId: proposal.proposedBy,
      });
    }

    if (!knowledgeItem) throw new NotFoundError("knowledge item not found or could not be created");

    await new SearchIndexer(app.db).upsert(knowledgeItem);

    const approved = await proposalStore.approve(orgId, id, actor.actorId, knowledgeItem.id);
    if (!approved) throw new NotFoundError("proposal already processed");

    await createAuditEventStore(app.db).append({
      organizationId: orgId, eventType: "APPROVE",
      targetId: knowledgeItem.id, targetType: "knowledge",
      actorId: actor.actorId, actorName: actor.actorId,
    });

    return { proposal: approved, knowledgeItem };
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/:id/reject", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    parseOrThrow(proposalIdSchema, id, "proposal id is malformed");
    const { reason } = parseOrThrow(rejectBodySchema, req.body ?? {}, "reason is required");

    const proposalStore = createProposalStore(app.db);
    const proposal = await proposalStore.findById(orgId, id);
    if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
    if (proposal.status !== "VALIDATING") throw new InvalidStatusTransitionError(proposal.status, "REJECTED");

    const rejected = await proposalStore.reject(orgId, id, actor.actorId, reason);
    if (!rejected) throw new NotFoundError("proposal already processed");

    await createAuditEventStore(app.db).append({
      organizationId: orgId, eventType: "REJECT", targetId: id, targetType: "knowledge",
      actorId: actor.actorId, actorName: actor.actorId, reason,
    });
    return rejected;
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/:id/request-changes", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    parseOrThrow(proposalIdSchema, id, "proposal id is malformed");
    const { feedback } = parseOrThrow(requestChangesBodySchema, req.body ?? {}, "feedback is required");

    const proposalStore = createProposalStore(app.db);
    const proposal = await proposalStore.findById(orgId, id);
    if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
    if (proposal.status !== "VALIDATING") throw new InvalidStatusTransitionError(proposal.status, "CHANGES_REQUESTED");

    const changed = await proposalStore.requestChanges(orgId, id, actor.actorId, feedback);
    if (!changed) throw new NotFoundError("proposal already processed");

    await createAuditEventStore(app.db).append({
      organizationId: orgId, eventType: "REQUEST_CHANGES", targetId: id, targetType: "knowledge",
      actorId: actor.actorId, actorName: actor.actorId, reason: feedback,
    });
    return changed;
  });
}
