import type { Db } from "mongodb";
import { newRelationId, type Relation, type RelationPredicate, type RelationStatus } from "./relation-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateRelationInput {
  organizationId: string;
  projectId: string;
  subjectId: string;
  predicate: RelationPredicate;
  objectId: string;
  status: RelationStatus;
  ownerId: string;
}

export interface RelationFilter {
  projectId?: string;
  predicate?: RelationPredicate;
  status?: RelationStatus;
}

export interface UpdateRelationPatch {
  subjectId?: string;
  predicate?: RelationPredicate;
  objectId?: string;
  status?: RelationStatus;
  reviewerId?: string;
}

export interface RelationStore {
  create(input: CreateRelationInput): Promise<Relation>;
  findById(organizationId: string, id: string): Promise<Relation | null>;
  findByProject(organizationId: string, filter: RelationFilter): Promise<Relation[]>;
  update(organizationId: string, id: string, patch: UpdateRelationPatch): Promise<Relation | null>;
  setSourceIds(organizationId: string, id: string, sourceIds: string[]): Promise<Relation | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

export function createRelationStore(db: Db): RelationStore {
  const col = () => db.collection<Relation>("relations");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const relation: Relation = {
        id: newRelationId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        subjectId: input.subjectId,
        predicate: input.predicate,
        objectId: input.objectId,
        status: input.status,
        version: 1,
        ownerId: input.ownerId,
        reviewerId: null,
        sourceIds: [],
        createdAt: now,
        updatedAt: now,
        lastVerifiedAt: null,
      };
      await col().insertOne({ ...relation });
      return relation;
    },

    async findById(organizationId, id) {
      return col().findOne({ id, organizationId }, READ_OPTS) as Promise<Relation | null>;
    },

    async findByProject(organizationId, filter) {
      const query: Record<string, unknown> = { organizationId };
      if (filter.projectId !== undefined) query.projectId = filter.projectId;
      if (filter.predicate !== undefined) query.predicate = filter.predicate;
      if (filter.status !== undefined) query.status = filter.status;
      return col().find(query, READ_OPTS).toArray() as Promise<Relation[]>;
    },

    async update(organizationId, id, patch) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { ...patch, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as Relation | null;
    },

    async setSourceIds(organizationId, id, sourceIds) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { sourceIds, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as Relation | null;
    },

    async delete(organizationId, id) {
      const result = await col().deleteOne({ id, organizationId });
      return result.deletedCount > 0;
    },
  };
}
