import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { newProposalId, type Proposal, type ProposalStatus } from "./proposal-entities.js";
import type { KnowledgeType } from "../knowledge-core/entities.js";
import type { ValidationResult } from "./proposal-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateProposalInput {
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  sourceIds: string[];
  triggeredBy: "bootstrap" | "incremental" | "manual";
  proposedBy: string;
  knowledgeItemId: string | null;
  validationResults: ValidationResult[];
}

export interface ProposalStore {
  create(input: CreateProposalInput): Promise<Proposal>;
  findById(orgId: string, id: string): Promise<Proposal | null>;
  findByProject(orgId: string, projectId: string, filter?: { status?: ProposalStatus }): Promise<Proposal[]>;
  existsByHash(orgId: string, projectId: string, hash: string): Promise<boolean>;
  approve(orgId: string, id: string, actorId: string, knowledgeItemId: string): Promise<Proposal | null>;
  reject(orgId: string, id: string, actorId: string, reason: string): Promise<Proposal | null>;
  requestChanges(orgId: string, id: string, actorId: string, feedback: string): Promise<Proposal | null>;
}

function hashProposal(type: string, title: string, summary: string): string {
  return createHash("sha256").update(`${type}:${title}:${summary}`).digest("hex");
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 11000;
}

export function createProposalStore(db: Db): ProposalStore {
  const col = () => db.collection<Proposal>("proposals");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const proposal: Proposal = {
        id: newProposalId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        knowledgeItemId: input.knowledgeItemId,
        type: input.type,
        title: input.title,
        summary: input.summary,
        content: input.content,
        status: "VALIDATING",
        proposedBy: input.proposedBy,
        proposedAt: now,
        validationResults: input.validationResults,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        changesFeedback: null,
        sourceIds: input.sourceIds,
        contentHash: hashProposal(input.type, input.title, input.summary),
        triggeredBy: input.triggeredBy,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await col().insertOne({ ...proposal });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          const existing = await col().findOne(
            { organizationId: input.organizationId, projectId: input.projectId, contentHash: proposal.contentHash } as unknown as Partial<Proposal>,
            READ_OPTS,
          );
          if (existing) return existing as Proposal;
        }
        throw err;
      }
      return proposal;
    },

    async findById(orgId, id) {
      return col().findOne({ id, organizationId: orgId }, READ_OPTS) as Promise<Proposal | null>;
    },

    async findByProject(orgId, projectId, filter) {
      const query: Record<string, unknown> = { organizationId: orgId, projectId };
      if (filter?.status) query.status = filter.status;
      return col().find(query as unknown as Partial<Proposal>, READ_OPTS).toArray() as Promise<Proposal[]>;
    },

    async existsByHash(orgId, projectId, hash) {
      return (await col().findOne({ organizationId: orgId, projectId, contentHash: hash } as unknown as Partial<Proposal>, READ_OPTS)) !== null;
    },

    async approve(orgId, id, actorId, knowledgeItemId) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "VALIDATING" } as unknown as Partial<Proposal>,
        { $set: { status: "PUBLISHED", reviewedBy: actorId, reviewedAt: now, knowledgeItemId, updatedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<Proposal | null>;
    },

    async reject(orgId, id, actorId, reason) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "VALIDATING" } as unknown as Partial<Proposal>,
        { $set: { status: "REJECTED", reviewedBy: actorId, reviewedAt: now, rejectionReason: reason, updatedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<Proposal | null>;
    },

    async requestChanges(orgId, id, actorId, feedback) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "VALIDATING" } as unknown as Partial<Proposal>,
        { $set: { status: "CHANGES_REQUESTED", reviewedBy: actorId, reviewedAt: now, changesFeedback: feedback, updatedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<Proposal | null>;
    },
  };
}
