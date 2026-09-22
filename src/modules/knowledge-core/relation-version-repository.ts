import type { Db } from "mongodb";
import { newRelationVersionId, type RelationVersion } from "./relation-version-entities.js";
import type { Relation } from "./relation-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface AppendRelationVersionInput {
  organizationId: string;
  relationId: string;
  version: number;
  snapshot: Relation;
  changedBy: string;
  changeSummary: string;
}

export interface RelationVersionStore {
  append(input: AppendRelationVersionInput): Promise<RelationVersion>;
  listByRelation(organizationId: string, relationId: string): Promise<RelationVersion[]>;
  findByVersion(organizationId: string, relationId: string, version: number): Promise<RelationVersion | null>;
}

export function createRelationVersionStore(db: Db): RelationVersionStore {
  const col = () => db.collection<RelationVersion>("relation_versions");

  return {
    async append(input) {
      const record: RelationVersion = {
        id: newRelationVersionId(),
        organizationId: input.organizationId,
        relationId: input.relationId,
        version: input.version,
        snapshot: input.snapshot,
        changedBy: input.changedBy,
        changedAt: new Date().toISOString(),
        changeSummary: input.changeSummary,
      };
      await col().insertOne({ ...record });
      return record;
    },

    async listByRelation(organizationId, relationId) {
      return col()
        .find({ organizationId, relationId }, READ_OPTS)
        .sort({ version: 1 })
        .toArray() as Promise<RelationVersion[]>;
    },

    async findByVersion(organizationId, relationId, version) {
      return col().findOne({ organizationId, relationId, version }, READ_OPTS) as Promise<RelationVersion | null>;
    },
  };
}
