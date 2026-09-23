import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { newProposalId, type KnowledgeProposal, type ProposalStatus } from "./entities.js";
import type { KnowledgeType } from "../knowledge-core/entities.js";

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
}

export interface ProposalStore {
  create(input: CreateProposalInput): Promise<KnowledgeProposal>;
  findById(orgId: string, id: string): Promise<KnowledgeProposal | null>;
  findByProject(orgId: string, projectId: string, filter?: { status?: ProposalStatus }): Promise<KnowledgeProposal[]>;
  existsByHash(orgId: string, projectId: string, hash: string): Promise<boolean>;
  approve(orgId: string, id: string, actorId: string, knowledgeItemId: string): Promise<KnowledgeProposal | null>;
  reject(orgId: string, id: string, actorId: string): Promise<KnowledgeProposal | null>;
}

function hashProposal(type: string, title: string, summary: string): string {
  return createHash("sha256").update(`${type}:${title}:${summary}`).digest("hex");
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 11000;
}

export function createProposalStore(db: Db): ProposalStore {
  const col = () => db.collection<KnowledgeProposal>("proposals");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const proposal: KnowledgeProposal = {
        id: newProposalId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        status: "PROPOSED",
        type: input.type,
        title: input.title,
        summary: input.summary,
        content: input.content,
        sourceIds: input.sourceIds,
        contentHash: hashProposal(input.type, input.title, input.summary),
        triggeredBy: input.triggeredBy,
        createdAt: now,
        reviewedBy: null,
        reviewedAt: null,
        knowledgeItemId: null,
      };
      try {
        await col().insertOne({ ...proposal });
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          const existing = await col().findOne(
            { organizationId: input.organizationId, projectId: input.projectId, contentHash: proposal.contentHash },
            READ_OPTS,
          );
          if (existing) return existing as KnowledgeProposal;
        }
        throw err;
      }
      return proposal;
    },

    async findById(orgId, id) {
      return col().findOne({ id, organizationId: orgId }, READ_OPTS) as Promise<KnowledgeProposal | null>;
    },

    async findByProject(orgId, projectId, filter) {
      const query: Record<string, unknown> = { organizationId: orgId, projectId };
      if (filter?.status) query.status = filter.status;
      return col().find(query, READ_OPTS).toArray() as Promise<KnowledgeProposal[]>;
    },

    async existsByHash(orgId, projectId, hash) {
      const found = await col().findOne({ organizationId: orgId, projectId, contentHash: hash }, READ_OPTS);
      return found !== null;
    },

    async approve(orgId, id, actorId, knowledgeItemId) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "PROPOSED" },
        { $set: { status: "APPROVED", reviewedBy: actorId, reviewedAt: now, knowledgeItemId } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<KnowledgeProposal | null>;
    },

    async reject(orgId, id, actorId) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "PROPOSED" },
        { $set: { status: "REJECTED", reviewedBy: actorId, reviewedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<KnowledgeProposal | null>;
    },
  };
}
