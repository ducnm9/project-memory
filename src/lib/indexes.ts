import type { Db, IndexDescription } from "mongodb";

export type IndexSpec = IndexDescription & { name: string };

interface CollectionIndexes {
  readonly collection: string;
  readonly indexes: readonly IndexSpec[];
}

/** Every core collection is tenant-scoped by (organizationId, projectId). */
const TENANCY_INDEX: IndexSpec = {
  key: { organizationId: 1, projectId: 1 },
  name: "org_project",
};

const CORE_COLLECTIONS = [
  "knowledge_items",
  "facts",
  "relations",
  "sources",
  "versions",
  "proposals",
  "audit_events",
  "knowledge_gaps",
] as const;

/**
 * Declarative index table. PM-002 seeds the shared tenancy index on every core
 * collection. Later model tickets append their specialized indexes here.
 */
export const CORE_INDEXES: ReadonlyArray<CollectionIndexes> = CORE_COLLECTIONS.map(
  (collection) => ({ collection, indexes: [TENANCY_INDEX] }),
);

/**
 * Ensures all declared indexes exist. `createIndexes` is idempotent: it is a
 * no-op for indexes that already exist, so this is safe to run on every boot.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  for (const { collection, indexes } of CORE_INDEXES) {
    await db.collection(collection).createIndexes(indexes as IndexDescription[]);
  }
}
