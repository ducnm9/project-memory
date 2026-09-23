import type { Db } from "mongodb";
import {
  newKnowledgeItemId,
  type KnowledgeItem,
  type KnowledgeStatus,
  type KnowledgeType,
} from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateKnowledgeItemInput {
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status: KnowledgeStatus;
  ownerId: string;
}

export interface KnowledgeItemFilter {
  projectId?: string;
  type?: KnowledgeType;
  status?: KnowledgeStatus;
}

export interface UpdateKnowledgeItemPatch {
  title?: string;
  summary?: string;
  content?: Record<string, unknown>;
  status?: KnowledgeStatus;
}

export interface KnowledgeItemStore {
  create(input: CreateKnowledgeItemInput): Promise<KnowledgeItem>;
  findById(organizationId: string, id: string): Promise<KnowledgeItem | null>;
  findByProject(
    organizationId: string,
    filter: KnowledgeItemFilter,
  ): Promise<KnowledgeItem[]>;
  update(
    organizationId: string,
    id: string,
    patch: UpdateKnowledgeItemPatch,
  ): Promise<KnowledgeItem | null>;
  setSourceIds(
    organizationId: string,
    id: string,
    sourceIds: string[],
  ): Promise<KnowledgeItem | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

export function createKnowledgeItemStore(db: Db): KnowledgeItemStore {
  const col = () => db.collection<KnowledgeItem>("knowledge_items");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const item: KnowledgeItem = {
        id: newKnowledgeItemId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        summary: input.summary,
        content: input.content,
        status: input.status,
        version: 1,
        ownerId: input.ownerId,
        createdAt: now,
        updatedAt: now,
        lastVerifiedAt: null,
        sourceIds: [],
        embedding: null,
        embeddingModel: null,
        embeddingUpdatedAt: null,
      };
      await col().insertOne({ ...item });
      return item;
    },

    async findById(organizationId, id) {
      return col().findOne({ id, organizationId }, READ_OPTS) as Promise<KnowledgeItem | null>;
    },

    async findByProject(organizationId, filter) {
      const query: Record<string, unknown> = { organizationId };
      if (filter.projectId !== undefined) query.projectId = filter.projectId;
      if (filter.type !== undefined) query.type = filter.type;
      if (filter.status !== undefined) query.status = filter.status;
      return col().find(query, READ_OPTS).toArray() as Promise<KnowledgeItem[]>;
    },

    async update(organizationId, id, patch) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { ...patch, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as KnowledgeItem | null;
    },

    async setSourceIds(organizationId, id, sourceIds) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { sourceIds, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as KnowledgeItem | null;
    },

    async delete(organizationId, id) {
      const result = await col().deleteOne({ id, organizationId });
      return result.deletedCount > 0;
    },
  };
}
