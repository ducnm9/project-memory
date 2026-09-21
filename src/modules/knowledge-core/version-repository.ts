import type { Db } from "mongodb";
import {
  newKnowledgeVersionId,
  type KnowledgeVersion,
} from "./version-entities.js";
import type { KnowledgeItem } from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface AppendVersionInput {
  organizationId: string;
  knowledgeId: string;
  version: number;
  snapshot: KnowledgeItem;
  changedBy: string;
  changeSummary: string;
}

export interface KnowledgeVersionStore {
  append(input: AppendVersionInput): Promise<KnowledgeVersion>;
  listByKnowledge(
    organizationId: string,
    knowledgeId: string,
  ): Promise<KnowledgeVersion[]>;
  findByVersion(
    organizationId: string,
    knowledgeId: string,
    version: number,
  ): Promise<KnowledgeVersion | null>;
}

export function createKnowledgeVersionStore(db: Db): KnowledgeVersionStore {
  const col = () => db.collection<KnowledgeVersion>("knowledge_versions");

  return {
    async append(input) {
      const record: KnowledgeVersion = {
        id: newKnowledgeVersionId(),
        organizationId: input.organizationId,
        knowledgeId: input.knowledgeId,
        version: input.version,
        snapshot: input.snapshot,
        changedBy: input.changedBy,
        changedAt: new Date().toISOString(),
        changeSummary: input.changeSummary,
      };
      await col().insertOne({ ...record });
      return record;
    },

    async listByKnowledge(organizationId, knowledgeId) {
      return col()
        .find({ organizationId, knowledgeId }, READ_OPTS)
        .sort({ version: 1 })
        .toArray() as Promise<KnowledgeVersion[]>;
    },

    async findByVersion(organizationId, knowledgeId, version) {
      return col().findOne(
        { organizationId, knowledgeId, version },
        READ_OPTS,
      ) as Promise<KnowledgeVersion | null>;
    },
  };
}
