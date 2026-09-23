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
  "fact_versions",
  "relation_versions",
] as const;

type CoreCollection = (typeof CORE_COLLECTIONS)[number];

/**
 * Specialized indexes appended after the shared tenancy index. PM-010 adds
 * knowledge-item identity and lookup indexes; later model tickets extend this
 * table for their own collection.
 */
const CORE_COLLECTION_EXTRA_INDEXES: Partial<Record<CoreCollection, readonly IndexSpec[]>> = {
  knowledge_items: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, type: 1 }, name: "project_type" },
    { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
  ],
  sources: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, type: 1 }, name: "project_type" },
  ],
  facts: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, predicate: 1 }, name: "project_predicate" },
    { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
  ],
  fact_versions: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, factId: 1 }, name: "fact_lookup" },
  ],
  relations: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, predicate: 1 }, name: "project_predicate" },
    { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
  ],
  relation_versions: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, relationId: 1 }, name: "relation_lookup" },
  ],
  audit_events: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, targetId: 1, timestamp: 1 }, name: "target_trail" },
    { key: { organizationId: 1, actorId: 1 }, name: "actor_lookup" },
  ],
  knowledge_gaps: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, question: 1 }, name: "project_question_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, status: 1, occurrenceCount: -1 }, name: "project_status_occurrence" },
  ],
  proposals: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
    { key: { organizationId: 1, projectId: 1, contentHash: 1 }, name: "content_hash_unique", unique: true },
  ],
};

export const CORE_INDEXES: ReadonlyArray<CollectionIndexes> = CORE_COLLECTIONS.map(
  (collection) => ({
    collection,
    indexes: [TENANCY_INDEX, ...(CORE_COLLECTION_EXTRA_INDEXES[collection] ?? [])],
  }),
);

/**
 * Root (non-tenant-scoped) collections. Kept separate from CORE_INDEXES so the
 * root vs tenant-scoped concepts stay distinct; ensureIndexes merges both.
 */
const ROOT_COLLECTION_INDEXES: ReadonlyArray<CollectionIndexes> = [
  {
    collection: "organizations",
    indexes: [{ key: { id: 1 }, name: "id_unique", unique: true }],
  },
  {
    collection: "projects",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      { key: { organizationId: 1 }, name: "org_lookup" },
    ],
  },
  {
    collection: "service_tokens",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      { key: { hashedSecret: 1 }, name: "hashed_secret_unique", unique: true },
      { key: { organizationId: 1 }, name: "org_lookup" },
    ],
  },
  {
    collection: "repositories",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: { organizationId: 1, url: 1 },
        name: "active_url_unique",
        unique: true,
        partialFilterExpression: { unboundAt: null },
      },
      { key: { organizationId: 1, projectId: 1 }, name: "project_lookup" },
    ],
  },
  {
    collection: "project_snapshots",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      { key: { projectId: 1, archivedAt: 1 }, name: "project_current" },
    ],
  },
];

export const ROOT_INDEXES = ROOT_COLLECTION_INDEXES;

/**
 * Ensures all declared indexes exist. `createIndexes` is idempotent: it is a
 * no-op for indexes that already exist, so this is safe to run on every boot.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  for (const { collection, indexes } of [...CORE_INDEXES, ...ROOT_INDEXES]) {
    await db.collection(collection).createIndexes(indexes as IndexDescription[]);
  }
}
