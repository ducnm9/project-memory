import type { Db } from "mongodb";
import { newFactVersionId, type FactVersion } from "./fact-version-entities.js";
import type { Fact } from "./fact-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface AppendFactVersionInput {
  organizationId: string;
  factId: string;
  version: number;
  snapshot: Fact;
  changedBy: string;
  changeSummary: string;
}

export interface FactVersionStore {
  append(input: AppendFactVersionInput): Promise<FactVersion>;
  listByFact(organizationId: string, factId: string): Promise<FactVersion[]>;
  findByVersion(organizationId: string, factId: string, version: number): Promise<FactVersion | null>;
}

export function createFactVersionStore(db: Db): FactVersionStore {
  const col = () => db.collection<FactVersion>("fact_versions");

  return {
    async append(input) {
      const record: FactVersion = {
        id: newFactVersionId(),
        organizationId: input.organizationId,
        factId: input.factId,
        version: input.version,
        snapshot: input.snapshot,
        changedBy: input.changedBy,
        changedAt: new Date().toISOString(),
        changeSummary: input.changeSummary,
      };
      await col().insertOne({ ...record });
      return record;
    },

    async listByFact(organizationId, factId) {
      return col()
        .find({ organizationId, factId }, READ_OPTS)
        .sort({ version: 1 })
        .toArray() as Promise<FactVersion[]>;
    },

    async findByVersion(organizationId, factId, version) {
      return col().findOne({ organizationId, factId, version }, READ_OPTS) as Promise<FactVersion | null>;
    },
  };
}
