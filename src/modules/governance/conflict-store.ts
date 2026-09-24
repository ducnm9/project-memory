import type { Db } from "mongodb";
import { newConflictId, type ConflictRecord, type ConflictResolution } from "./conflict-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateConflictInput {
  organizationId: string;
  projectId: string;
  proposalId: string;
  conflictingKnowledgeId: string;
  explanation: string;
}

export interface ConflictStore {
  create(input: CreateConflictInput): Promise<ConflictRecord>;
  findById(orgId: string, id: string): Promise<ConflictRecord | null>;
  findByProject(orgId: string, projectId: string, filter?: { status?: "OPEN" | "RESOLVED" }): Promise<ConflictRecord[]>;
  findByProposal(orgId: string, proposalId: string): Promise<ConflictRecord[]>;
  resolve(orgId: string, id: string, actorId: string, resolution: ConflictResolution, mergedContent?: Record<string, unknown>): Promise<ConflictRecord | null>;
}

export function createConflictStore(db: Db): ConflictStore {
  const col = () => db.collection<ConflictRecord>("conflicts");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const record: ConflictRecord = {
        id: newConflictId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        proposalId: input.proposalId,
        conflictingKnowledgeId: input.conflictingKnowledgeId,
        explanation: input.explanation,
        status: "OPEN",
        resolution: null,
        mergedContent: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: now,
      };
      await col().insertOne({ ...record });
      return record;
    },

    async findById(orgId, id) {
      return col().findOne({ id, organizationId: orgId }, READ_OPTS) as Promise<ConflictRecord | null>;
    },

    async findByProject(orgId, projectId, filter) {
      const query: Record<string, unknown> = { organizationId: orgId, projectId };
      if (filter?.status) query.status = filter.status;
      return col().find(query as unknown as Partial<ConflictRecord>, READ_OPTS).toArray() as Promise<ConflictRecord[]>;
    },

    async findByProposal(orgId, proposalId) {
      return col().find({ organizationId: orgId, proposalId } as unknown as Partial<ConflictRecord>, READ_OPTS).toArray() as Promise<ConflictRecord[]>;
    },

    async resolve(orgId, id, actorId, resolution, mergedContent) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "OPEN" } as unknown as Partial<ConflictRecord>,
        { $set: { status: "RESOLVED", resolution, mergedContent: mergedContent ?? null, resolvedBy: actorId, resolvedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<ConflictRecord | null>;
    },
  };
}
