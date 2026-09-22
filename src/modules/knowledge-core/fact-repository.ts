import type { Db } from "mongodb";
import { newFactId, type Fact, type FactStatus } from "./fact-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateFactInput {
  organizationId: string;
  projectId: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  status: FactStatus;
  ownerId: string;
}

export interface FactFilter {
  projectId?: string;
  predicate?: string;
  status?: FactStatus;
}

export interface UpdateFactPatch {
  subjectId?: string;
  predicate?: string;
  objectId?: string;
  status?: FactStatus;
}

export interface FactStore {
  create(input: CreateFactInput): Promise<Fact>;
  findById(organizationId: string, id: string): Promise<Fact | null>;
  findByProject(organizationId: string, filter: FactFilter): Promise<Fact[]>;
  update(organizationId: string, id: string, patch: UpdateFactPatch): Promise<Fact | null>;
  setSourceIds(organizationId: string, id: string, sourceIds: string[]): Promise<Fact | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

export function createFactStore(db: Db): FactStore {
  const col = () => db.collection<Fact>("facts");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const fact: Fact = {
        id: newFactId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        subjectId: input.subjectId,
        predicate: input.predicate,
        objectId: input.objectId,
        status: input.status,
        version: 1,
        ownerId: input.ownerId,
        sourceIds: [],
        createdAt: now,
        updatedAt: now,
        lastVerifiedAt: null,
      };
      await col().insertOne({ ...fact });
      return fact;
    },

    async findById(organizationId, id) {
      return col().findOne({ id, organizationId }, READ_OPTS) as Promise<Fact | null>;
    },

    async findByProject(organizationId, filter) {
      const query: Record<string, unknown> = { organizationId };
      if (filter.projectId !== undefined) query.projectId = filter.projectId;
      if (filter.predicate !== undefined) query.predicate = filter.predicate;
      if (filter.status !== undefined) query.status = filter.status;
      return col().find(query, READ_OPTS).toArray() as Promise<Fact[]>;
    },

    async update(organizationId, id, patch) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { ...patch, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as Fact | null;
    },

    async setSourceIds(organizationId, id, sourceIds) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { sourceIds, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as Fact | null;
    },

    async delete(organizationId, id) {
      const result = await col().deleteOne({ id, organizationId });
      return result.deletedCount > 0;
    },
  };
}
