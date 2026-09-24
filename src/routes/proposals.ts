import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/index.js";
import { createProposalStore } from "../modules/ingestion/proposal-repository.js";
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createKnowledgeVersionStore } from "../modules/knowledge-core/version-repository.js";
import { createAuditEventStore } from "../modules/governance/audit-repository.js";
import { createSourceStore } from "../modules/knowledge-core/source-repository.js";
import { SearchIndexer } from "../modules/retrieval/search-indexer.js";
import { orgIdSchema, projectIdSchema } from "../modules/project-context/entities.js";
import { knowledgeTypeSchema } from "../modules/knowledge-core/entities.js";
import { validateContent } from "../modules/knowledge-core/contracts.js";
import { sourceIdSchema } from "../modules/knowledge-core/source-entities.js";
import { PROPOSAL_STATUSES, type ProposalStatus } from "../modules/ingestion/entities.js";
import { DuplicateDetector } from "../modules/governance/duplicate-detector.js";
import { ContradictionDetector } from "../modules/governance/contradiction-detector.js";
import { z } from "zod";
import {
  DuplicateProposalError,
  EvidenceValidationError,
  ForbiddenScopeError,
  InvalidStatusTransitionError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";

const proposalIdSchema = z.string().regex(/^prop_[0-9A-HJKMNP-TV-Z]{26}$/);
const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

const nonEmpty = (msg = "required") => z.string().trim().min(1, msg);

const createProposalBodySchema = z.object({
  projectId: nonEmpty(),
  type: knowledgeTypeSchema,
  title: nonEmpty(),
  summary: nonEmpty(),
  content: z.record(z.unknown()).default({}),
  sourceIds: z.array(sourceIdSchema).default([]),
  triggeredBy: z.enum(["bootstrap", "incremental", "manual"]).default("manual"),
}).strict();

function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, value: unknown, message: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(message);
  return r.data as T;
}

export function registerProposalRoutes(app: FastifyInstance, config: AppConfig): void {
  const BEARER = { config: { auth: "bearer" as const } };

  // Issue 28 + 29 + 30: Manual proposal creation with structural validation,
  // duplicate detection, and contradiction detection
  app.post(
    "/organizations/:orgId/projects/:projectId/proposals",
    BEARER,
    async (req, reply) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId } = req.params as { orgId: string; projectId: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");

      if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");

      // Parse body
      const parsed = createProposalBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new ValidationError(issues);
      }
      const body = parsed.data;

      // Issue 28: structural content validation per type
      const validatedContent = validateContent(body.type, body.content);

      // Issue 29: duplicate detection
      const dupDetector = new DuplicateDetector(app.db, config.embedding ?? undefined);
      const dupResult = await dupDetector.detect(orgId, projectId, body.type, body.title, body.summary, body.sourceIds);
      if (dupResult?.duplicate) {
        throw new DuplicateProposalError(
          `duplicate detected: existing item ${dupResult.existingId} (${dupResult.reason})`,
        );
      }

      // Issue 30: contradiction detection (never blocks)
      const contraDetector = new ContradictionDetector(app.db, config.llm ?? undefined, config.embedding ?? undefined);
      const contradictions = await contraDetector.detect(orgId, projectId, body.type, body.title, body.summary, validatedContent);

      const proposalStore = createProposalStore(app.db);
      const proposal = await proposalStore.create({
        organizationId: orgId,
        projectId: body.projectId,
        type: body.type,
        title: body.title,
        summary: body.summary,
        content: validatedContent,
        sourceIds: body.sourceIds,
        triggeredBy: body.triggeredBy,
        proposedBy: actor.actorId,
        knowledgeItemId: null,
        validationResults: [],
      });

      const response: Record<string, unknown> = { ...proposal };
      if (dupResult) {
        response.warnings = [`near-duplicate: existing item ${dupResult.existingId} (score: ${dupResult.similarityScore?.toFixed(2) ?? "n/a"})`];
      }
      if (contradictions.length > 0) {
        response.contradictions = contradictions;
      }

      reply.status(201);
      return response;
    },
  );

  app.get(
    "/organizations/:orgId/projects/:projectId/proposals",
    BEARER,
    async (req) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId } = req.params as { orgId: string; projectId: string };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");

      if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");

      const { status } = req.query as { status?: string };

      let statusFilter: ProposalStatus | undefined;
      if (status !== undefined) {
        const r = proposalStatusSchema.safeParse(status);
        if (!r.success) throw new ValidationError("invalid status");
        statusFilter = r.data;
      }

      const store = createProposalStore(app.db);
      const proposals = await store.findByProject(
        orgId,
        projectId,
        statusFilter ? { status: statusFilter } : undefined,
      );
      return { proposals };
    },
  );

  app.get(
    "/organizations/:orgId/projects/:projectId/proposals/:id",
    BEARER,
    async (req) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId, id } = req.params as {
        orgId: string;
        projectId: string;
        id: string;
      };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(proposalIdSchema, id, "proposal id is malformed");

      if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");

      const store = createProposalStore(app.db);
      const proposal = await store.findById(orgId, id);
      if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
      return proposal;
    },
  );

  app.post(
    "/organizations/:orgId/projects/:projectId/proposals/:id/approve",
    BEARER,
    async (req) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId, id } = req.params as {
        orgId: string;
        projectId: string;
        id: string;
      };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(proposalIdSchema, id, "proposal id is malformed");

      const proposalStore = createProposalStore(app.db);
      const proposal = await proposalStore.findById(orgId, id);
      if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (proposal.status !== "VALIDATING")
        throw new InvalidStatusTransitionError(proposal.status, "PUBLISHED");

      // Evidence validation
      const sourceStore = createSourceStore(app.db);
      for (const srcId of proposal.sourceIds) {
        const src = await sourceStore.findById(orgId, srcId);
        if (!src) throw new EvidenceValidationError(`source not found: ${srcId}`);
      }

      const warnings: string[] = [];
      if (
        proposal.sourceIds.length === 0 &&
        proposal.triggeredBy !== "manual" &&
        (proposal.type === "Decision" || proposal.type === "Architecture")
      ) {
        warnings.push("no supporting sources provided");
      }

      const knowledgeStore = createKnowledgeItemStore(app.db);
      const vStore = createKnowledgeVersionStore(app.db);

      const item = await knowledgeStore.create({
        organizationId: orgId,
        projectId,
        type: proposal.type,
        title: proposal.title,
        summary: proposal.summary,
        content: proposal.content,
        status: "PUBLISHED",
        ownerId: actor.actorId,
      });

      const itemWithSources = await knowledgeStore.setSourceIds(orgId, item.id, proposal.sourceIds);

      await vStore.append({
        organizationId: orgId,
        knowledgeId: item.id,
        version: 1,
        snapshot: item,
        changedBy: actor.actorId,
        changeSummary: `created from proposal ${id}`,
      });

      if (itemWithSources) {
        await new SearchIndexer(app.db).upsert(itemWithSources);
      }

      await createAuditEventStore(app.db).append({
        organizationId: orgId,
        eventType: "CREATE",
        targetId: item.id,
        targetType: "knowledge",
        actorId: actor.actorId,
        actorName: actor.actorId,
        reason: `created from proposal ${id}`,
      });

      const approved = await proposalStore.approve(orgId, id, actor.actorId, item.id);
      if (!approved) throw new NotFoundError("proposal not found");
      return warnings.length > 0 ? { ...approved, warnings } : approved;
    },
  );

  app.post(
    "/organizations/:orgId/projects/:projectId/proposals/:id/reject",
    BEARER,
    async (req) => {
      const actor = req.actor;
      if (!actor) throw new UnauthorizedError("missing credentials");

      const { orgId, projectId, id } = req.params as {
        orgId: string;
        projectId: string;
        id: string;
      };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(proposalIdSchema, id, "proposal id is malformed");

      const store = createProposalStore(app.db);
      const proposal = await store.findById(orgId, id);
      if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (proposal.status !== "VALIDATING")
        throw new InvalidStatusTransitionError(proposal.status, "REJECTED");

      const rejected = await store.reject(orgId, id, actor.actorId, "rejected by reviewer");
      if (!rejected) throw new NotFoundError("proposal not found");
      return rejected;
    },
  );
}
