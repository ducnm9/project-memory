import type { FastifyInstance } from "fastify";
import { createProposalStore } from "../modules/ingestion/proposal-repository.js";
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createKnowledgeVersionStore } from "../modules/knowledge-core/version-repository.js";
import { PROPOSAL_STATUSES, type ProposalStatus } from "../modules/ingestion/entities.js";
import { z } from "zod";
import {
  InvalidStatusTransitionError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";

const proposalStatusSchema = z.enum(PROPOSAL_STATUSES);

export function registerProposalRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.get(
    "/organizations/:orgId/projects/:projectId/proposals",
    BEARER,
    async (req) => {
      const { orgId, projectId } = req.params as { orgId: string; projectId: string };
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
      const { orgId, projectId, id } = req.params as {
        orgId: string;
        projectId: string;
        id: string;
      };
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

      const proposalStore = createProposalStore(app.db);
      const proposal = await proposalStore.findById(orgId, id);
      if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (proposal.status !== "PROPOSED")
        throw new InvalidStatusTransitionError(proposal.status, "APPROVED");

      const knowledgeStore = createKnowledgeItemStore(app.db);
      const vStore = createKnowledgeVersionStore(app.db);

      const item = await knowledgeStore.create({
        organizationId: orgId,
        projectId,
        type: proposal.type,
        title: proposal.title,
        summary: proposal.summary,
        content: proposal.content,
        status: "PROPOSED",
        ownerId: actor.actorId,
      });

      await knowledgeStore.setSourceIds(orgId, item.id, proposal.sourceIds);

      await vStore.append({
        organizationId: orgId,
        knowledgeId: item.id,
        version: 1,
        snapshot: item,
        changedBy: actor.actorId,
        changeSummary: `created from proposal ${id}`,
      });

      const approved = await proposalStore.approve(orgId, id, actor.actorId, item.id);
      if (!approved) throw new NotFoundError("proposal not found");
      return approved;
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

      const store = createProposalStore(app.db);
      const proposal = await store.findById(orgId, id);
      if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (proposal.status !== "PROPOSED")
        throw new InvalidStatusTransitionError(proposal.status, "REJECTED");

      const rejected = await store.reject(orgId, id, actor.actorId);
      if (!rejected) throw new NotFoundError("proposal not found");
      return rejected;
    },
  );
}
