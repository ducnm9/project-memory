import type { Db } from "mongodb";
import { newSourceId, type Source, type SourceType } from "./source-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateSourceInput {
  organizationId: string;
  projectId: string;
  type: SourceType;
  locator: string;
  metadata: Record<string, unknown>;
  createdBy: string;
}

export interface SourceFilter {
  projectId?: string;
  type?: SourceType;
}

export interface SourceStore {
  create(input: CreateSourceInput): Promise<Source>;
  findById(organizationId: string, id: string): Promise<Source | null>;
  findByProject(organizationId: string, filter: SourceFilter): Promise<Source[]>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

export function createSourceStore(db: Db): SourceStore {
  const col = () => db.collection<Source>("sources");

  return {
    async create(input) {
      const source: Source = {
        id: newSourceId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        type: input.type,
        locator: input.locator,
        metadata: input.metadata,
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
      };
      await col().insertOne({ ...source });
      return source;
    },

    async findById(organizationId, id) {
      return col().findOne({ id, organizationId }, READ_OPTS) as Promise<Source | null>;
    },

    async findByProject(organizationId, filter) {
      const query: Record<string, unknown> = { organizationId };
      if (filter.projectId !== undefined) query.projectId = filter.projectId;
      if (filter.type !== undefined) query.type = filter.type;
      return col().find(query, READ_OPTS).toArray() as Promise<Source[]>;
    },

    async delete(organizationId, id) {
      const result = await col().deleteOne({ id, organizationId });
      return result.deletedCount > 0;
    },
  };
}
