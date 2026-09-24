import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createConflictStore } from "../modules/governance/conflict-store.js";
import { createProposalStore } from "../modules/governance/proposal-store.js";
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createAuditEventStore } from "../modules/governance/audit-repository.js";
import { SearchIndexer } from "../modules/retrieval/search-indexer.js";
import { requireRole } from "../modules/auth/actor.js";
import { ForbiddenScopeError, NotFoundError, UnauthorizedError, ValidationError } from "../lib/errors.js";

const resolveBodySchema = z.object({
  action: z.enum(["KEEP_EXISTING", "ACCEPT_NEW", "MERGE"]),
  mergedContent: z.record(z.unknown()).optional(),
}).strict();

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } },
  value: unknown,
  msg: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(r.error?.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") ?? msg);
  return r.data as T;
}

export function registerConflictRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.get("/organizations/:orgId/projects/:projectId/conflicts", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const { status } = req.query as { status?: string };
    let statusFilter: "OPEN" | "RESOLVED" | undefined;
    if (status === "OPEN" || status === "RESOLVED") statusFilter = status;
    else if (status) throw new ValidationError("status must be OPEN or RESOLVED");
    const store = createConflictStore(app.db);
    const conflicts = await store.findByProject(orgId, projectId, { status: statusFilter });
    return { conflicts, total: conflicts.length };
  });

  app.post("/conflicts/:id/resolve", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { id } = req.params as { id: string };
    const { action, mergedContent } = parseOrThrow(resolveBodySchema, req.body ?? {}, "action required");
    if (action === "MERGE" && !mergedContent) throw new ValidationError("mergedContent required for MERGE resolution");

    const conflictStore = createConflictStore(app.db);
    const conflict = await conflictStore.findById(actor.organizationId, id);
    if (!conflict) throw new NotFoundError("conflict not found");
    if (conflict.status === "RESOLVED") throw new ValidationError("conflict already resolved");

    const proposalStore = createProposalStore(app.db);
    const knowledgeStore = createKnowledgeItemStore(app.db);
    const auditStore = createAuditEventStore(app.db);

    if (action === "KEEP_EXISTING") {
      await proposalStore.reject(actor.organizationId, conflict.proposalId, actor.actorId, "conflict resolved: keep existing");
    } else if (action === "ACCEPT_NEW") {
      const proposal = await proposalStore.findById(actor.organizationId, conflict.proposalId);
      if (proposal) {
        const item = await knowledgeStore.create({
          organizationId: actor.organizationId, projectId: conflict.projectId,
          type: proposal.type, title: proposal.title, summary: proposal.summary,
          content: proposal.content, status: "PUBLISHED", ownerId: proposal.proposedBy,
        });
        await new SearchIndexer(app.db).upsert(item);
        await proposalStore.approve(actor.organizationId, conflict.proposalId, actor.actorId, item.id);
      }
      await knowledgeStore.update(actor.organizationId, conflict.conflictingKnowledgeId, { status: "DEPRECATED" });
    } else if (action === "MERGE") {
      const proposal = await proposalStore.findById(actor.organizationId, conflict.proposalId);
      if (proposal && mergedContent) {
        const item = await knowledgeStore.create({
          organizationId: actor.organizationId, projectId: conflict.projectId,
          type: proposal.type, title: proposal.title, summary: proposal.summary,
          content: mergedContent, status: "PUBLISHED", ownerId: proposal.proposedBy,
        });
        await new SearchIndexer(app.db).upsert(item);
        await proposalStore.approve(actor.organizationId, conflict.proposalId, actor.actorId, item.id);
      }
      await knowledgeStore.update(actor.organizationId, conflict.conflictingKnowledgeId, { status: "DEPRECATED" });
    }

    await auditStore.append({
      organizationId: actor.organizationId, eventType: "RESOLVE_CONFLICT",
      targetId: id, targetType: "knowledge",
      actorId: actor.actorId, actorName: actor.actorId, reason: action,
    });

    return conflictStore.resolve(actor.organizationId, id, actor.actorId, action, mergedContent);
  });
}
