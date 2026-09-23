import type { Db } from "mongodb";
import { newGapId, type GapStatus, type KnowledgeGap } from "./gap-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface UpdateGapPatch {
  ownerId?: string | null;
  relatedKnowledgeIds?: string[];
  status?: GapStatus;
}

export interface GapStore {
  upsertOnQuestion(organizationId: string, projectId: string, question: string): Promise<KnowledgeGap>;
  findByProject(organizationId: string, projectId: string, status?: GapStatus): Promise<KnowledgeGap[]>;
  findById(organizationId: string, id: string): Promise<KnowledgeGap | null>;
  update(organizationId: string, id: string, patch: UpdateGapPatch): Promise<KnowledgeGap | null>;
}

export function createGapStore(db: Db): GapStore {
  const col = () => db.collection<KnowledgeGap>("knowledge_gaps");

  return {
    async upsertOnQuestion(organizationId, projectId, question) {
      const now = new Date().toISOString();
      // ponytail: two-round-trip upsert; replace with real $setOnInsert upsert if fake-db gains upsert support
      const existing = (await col().findOne(
        { organizationId, projectId, question } as Partial<KnowledgeGap>,
        READ_OPTS,
      )) as KnowledgeGap | null;

      if (!existing) {
        const gap: KnowledgeGap = {
          id: newGapId(),
          organizationId,
          projectId,
          question,
          occurrenceCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          attemptedSearches: [{ searchedAt: now, query: question }],
          relatedKnowledgeIds: [],
          ownerId: null,
          status: "OPEN",
        };
        await col().insertOne({ ...gap } as KnowledgeGap);
        return gap;
      }

      // Append to attemptedSearches in-memory so we can $set the full array
      // (avoids needing $push, which fake-db does not support)
      const newSearches = [
        ...existing.attemptedSearches,
        { searchedAt: now, query: question },
      ];

      const result = await col().findOneAndUpdate(
        { organizationId, projectId, question } as Partial<KnowledgeGap>,
        {
          $inc: { occurrenceCount: 1 },
          $set: { lastSeenAt: now, attemptedSearches: newSearches },
        },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as KnowledgeGap;
    },

    async findByProject(organizationId, projectId, status) {
      const query: Record<string, unknown> = { organizationId, projectId };
      if (status !== undefined) query.status = status;
      return col()
        .find(query as Partial<KnowledgeGap>, READ_OPTS)
        .sort({ occurrenceCount: -1 })
        .toArray() as Promise<KnowledgeGap[]>;
    },

    async findById(organizationId, id) {
      return col().findOne(
        { id, organizationId } as Partial<KnowledgeGap>,
        READ_OPTS,
      ) as Promise<KnowledgeGap | null>;
    },

    async update(organizationId, id, patch) {
      const result = await col().findOneAndUpdate(
        { id, organizationId } as Partial<KnowledgeGap>,
        { $set: patch },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as KnowledgeGap | null;
    },
  };
}
