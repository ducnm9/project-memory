# Provenance / Source Model — Design Spec

- **Date:** 2026-09-21
- **Issue:** [PM-013] Provenance/source model (`epic:knowledge-core`, milestone M0)
- **Status:** Approved for planning

## Summary

Introduce `Source` as a first-class, tenant-scoped, near-immutable entity
(create + read + delete, no update, no state machine) that records where a
piece of knowledge came from. A new `sources` collection stores one document
per source. A thin one-way link `sourceIds: string[]` is added to
`KnowledgeItem`, managed through dedicated attach/detach endpoints; every
attach/detach that changes the item appends a version snapshot, reusing the
existing PM-012 versioning machinery.

Sources are independent resources — reusable across items and not owned by any
single knowledge item. The only link direction is `KnowledgeItem.sourceIds` →
`Source.id`; consumers read an item, then resolve its sources as needed.

## Scope decisions (from brainstorming)

- **Primary consumer (Q1 → A):** Sources are a standalone resource plus a thin
  `sourceIds` reference on `KnowledgeItem`. Fact linkage (PM-014) and relation
  linkage (PM-015) are deferred to their own tickets.
- **Entity shape (Q2 → A):** a single unified `Source` entity with a `type`
  enum and an open `metadata` blob, validated lightly by `type` (enum check
  only; no per-type metadata schema yet).
- **Link placement (Q3 → A):** `sourceIds: string[]` directly on `KnowledgeItem`,
  attached/detached via dedicated endpoints, each change writing a version
  snapshot.
- **Lifecycle (Q4 → B):** near-immutable — create + read + delete, no `PATCH`,
  no state machine. Nothing on a source changes after creation. Deletion is
  allowed so a mistaken source can be removed.
- **Referential integrity (Q5 → A):** validate on attach (source must exist and
  belong to the same org); accept dangling references on delete — no cascade.
- **`locator` required (Q2 follow-up):** every source carries a required,
  human-readable `locator` string as its display/lookup key.
- **Attach idempotency (Q4/endpoints follow-up):** attaching an already-linked
  `sourceId` is idempotent — no duplicate id, no version bump, no new snapshot.

## Data model

New entity `Source` in `src/modules/knowledge-core/source-entities.ts`:

```ts
export const SOURCE_TYPES = [
  "repository_file",
  "git_commit",
  "github_pr",
  "github_issue",
  "jira_issue",
  "document",
  "human_input",
  "agent_proposal",
  "runtime_observation",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface Source {
  id: string;               // "src_" + ULID
  organizationId: string;   // tenant scope, consistent with every other collection
  projectId: string;        // a source belongs to a project
  type: SourceType;
  locator: string;          // primary human-readable identifier (URL, SHA, path, ...)
  metadata: Record<string, unknown>; // open blob for type-dependent details; not validated by type
  createdBy: string;        // actor.actorId
  createdAt: string;        // ISO timestamp
}
```

Details:

- `id` uses prefix `src_` + ULID, matching the `know_` / `kver_` style. Add
  `newSourceId()`.
- `organizationId` is stored so every source query is tenant-scoped, consistent
  with all existing repositories.
- `locator` is a required non-empty string: the source's human-readable address
  (PR URL, commit SHA, file path, document title). It gives every source a
  consistent display/lookup key without digging into `metadata`. This is the
  only field beyond the `KnowledgeItem.content` analogue — a source always needs
  an address.
- `metadata` is an open `Record<string, unknown>`, defaulting to `{}`, mirroring
  how `KnowledgeItem.content` works.
- **No `status`, no `version`, no `updatedAt`** — matches the near-immutable
  decision. Nothing changes after creation.

### Validation (light, by type)

Per Q2 (unified, light validation), there is **no** per-type metadata schema.
Validation is:

- `type` must be a member of `SOURCE_TYPES` (enum) → else 400.
- `locator` must be a non-empty (trimmed, min 1) string → required for all types.
- `metadata` is any object, defaulting to `{}`.

```ts
export const sourceIdSchema = z.string().regex(/^src_[0-9A-HJKMNP-TV-Z]{26}$/);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);

export const createSourceBodySchema = z
  .object({
    projectId: nonEmpty,
    type: sourceTypeSchema,
    locator: nonEmpty,
    metadata: z.record(z.unknown()).default({}),
  })
  .strict();

export function newSourceId(): string {
  return `src_${ulid()}`;
}
```

(`nonEmpty` is the local `z.string().trim().min(1)` helper defined in the file,
matching `entities.ts`; `projectIdSchema` is imported from `project-context` and
applied in the route layer, as in `knowledge.ts`.)

> `ponytail:` ceiling — metadata is an unvalidated open blob. If a later type
> needs required fields (e.g. `git_commit` needs `sha`), upgrade to per-type
> Zod schemas keyed by `type` (the `CONTENT_SCHEMAS` pattern in `contracts.ts`).

### KnowledgeItem change

Add `sourceIds: string[]` to `KnowledgeItem` (`entities.ts`), defaulting to `[]`.
Items created before PM-013 have no such field; read paths treat a missing value
as `[]` (backward compatible). New items always initialize `sourceIds: []`.

## Repository & write path

New repository `src/modules/knowledge-core/source-repository.ts`:

```ts
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
```

- Collection `sources`, projection `{ _id: 0 }` like other repos.
- **No `update`** — matches the near-immutable decision. `create` only inserts;
  `delete` is `deleteOne` returning `deletedCount > 0`.
- `create` generates `id` via `newSourceId()` and sets `createdAt` to the current
  ISO timestamp.
- Every query is scoped by `organizationId` (first argument), consistent with
  existing repositories.
- `findByProject` filters `organizationId` plus optional `projectId` / `type`,
  mirroring the knowledge-item `findByProject`.

Change to existing `KnowledgeItemStore` (`repository.ts`):

- `create` initializes `sourceIds: []` on new items.
- Add a dedicated method
  `setSourceIds(organizationId, id, sourceIds): Promise<KnowledgeItem | null>`
  using `$set: { sourceIds, updatedAt }` **and** `$inc: { version: 1 }` in one
  `findOneAndUpdate`, returning the document after the change (carrying the new
  `version`). The new version number is an atomic DB result, never computed in
  the app layer — consistent with the PM-012 update path.

Attach/detach is kept as its own semantic operation rather than folded into the
generic `UpdateKnowledgeItemPatch` (which runs content validation and status
transition checks). Separating the write paths keeps each one single-purpose.

**Backward compatibility:** when mapping a pre-PM-013 document that lacks
`sourceIds`, read paths use `item.sourceIds ?? []`. New writes always carry the
field.

## API endpoints

All use `BEARER` auth and are tenant-scoped by `organizationId`, matching
existing routes. Two groups: source CRUD (new `src/routes/sources.ts`) and
attach/detach on a knowledge item (added to `src/routes/knowledge.ts`).

### Group 1 — Sources (standalone resource)

**`POST /sources`**
- Validate body via `createSourceBodySchema`; bad `type` → 400, empty `locator`
  → 400, unknown field (`.strict()`) → 400.
- Validate `projectId` via `projectIdSchema`; confirm the project exists in the
  org (`requireProject`) → else `TenantNotFoundError` (404), like the knowledge
  route.
- Create with `createdBy = actor.actorId`. Return `201` + source.

**`GET /sources/:id`**
- Validate `id` via `sourceIdSchema` (bad → 400).
- Not found → `SourceNotFoundError` (404).

**`GET /sources`**
- Optional query `projectId` (validated + `requireProject`) and `type`
  (validated enum).
- Return `{ sources: [...] }`, matching the `{ items }` / `{ versions }` shape.

**`DELETE /sources/:id`**
- Validate `id`; not found → 404.
- On success return `204`. **No** cascade into any item's `sourceIds` — dangling
  references are accepted (the referential-integrity ceiling below).

### Group 2 — Attach / detach on a knowledge item

**`POST /knowledge/:id/sources`** — attach a source to an item.
- Body `{ sourceId: string }`, validated via `sourceIdSchema`.
- Validate `:id` via `knowledgeIdSchema`; item missing → `KnowledgeNotFoundError`
  (404).
- **Validate on attach:** the source must exist and belong to the same org
  (`sourceStore.findById`) → else `SourceNotFoundError` (404).
- If `sourceId` is already present in `sourceIds` → idempotent: no duplicate, no
  version bump, no snapshot; return the current item.
- Otherwise append the id, call `setSourceIds` (version bumps), append a version
  snapshot with `changeSummary` of the form `"attached source src_..."`. Return
  the updated item.

**`DELETE /knowledge/:id/sources/:sourceId`** — detach a link.
- Validate both ids; item missing → `KnowledgeNotFoundError` (404).
- If `sourceId` is not in `sourceIds` → `SourceNotFoundError` (404) (no link to
  remove).
- Otherwise remove it, call `setSourceIds` (version bumps), append a snapshot
  `"detached source src_..."`. Return the updated item.
- This removes only the **link**, never the `Source` record.

**Route registration.** `/knowledge/:id/sources` differs from `/knowledge/:id`
in path-segment count, so Fastify does not confuse them (same as versioning).
`POST /sources` and `POST /knowledge/:id/sources` have different prefixes and are
independent. Declaration order is kept explicit anyway.

**Versioning on attach/detach.** Each successful attach/detach appends a version
snapshot (reusing the `vStore` already wired into `knowledge.ts`), consistent
with "every item change is versioned". `changedBy = actor.actorId`.

> `ponytail:` ceiling — no cross-document transaction between `setSourceIds` and
> the version append (same limitation as PM-012). A crash between the two can
> leave the item at version N without the version-N snapshot. Upgrade path — a
> Mongo multi-document transaction on a replica set.

## Error handling

Reuse existing errors in `src/lib/errors.ts`; add **one** new error.

**New error:**

- `SourceNotFoundError` → HTTP 404, code `SOURCE_NOT_FOUND`. Needed because
  `KnowledgeNotFoundError` carries knowledge-item semantics; returning it for a
  missing source would mislead. Follows the `KnowledgeNotFoundError` pattern.

**Reused errors:**

- Malformed `id` (`sourceIdSchema` / `knowledgeIdSchema` fail) → `ValidationError`
  (400).
- Bad body (missing `locator`, bad `type` enum, malformed `sourceId`, empty body)
  → `ValidationError` (400).
- Malformed `projectId` → `ValidationError` (400).
- Project not found in org → `TenantNotFoundError` (404).
- Knowledge item not found (attach/detach) → `KnowledgeNotFoundError` (404).
- Missing credentials → `UnauthorizedError` (401).
- Missing/malformed `x-organization-id` → `InvalidTenantScopeError`, via the
  existing `context(req)` helper.

**Per-route 404 mapping:**

| Situation | Error | Status |
|---|---|---|
| `GET`/`DELETE /sources/:id` source missing | `SourceNotFoundError` | 404 |
| `POST /knowledge/:id/sources` source missing / other org | `SourceNotFoundError` | 404 |
| `POST`/`DELETE /knowledge/:id/sources...` item missing | `KnowledgeNotFoundError` | 404 |
| `DELETE /knowledge/:id/sources/:sourceId` link absent | `SourceNotFoundError` | 404 |

**Tenant isolation.** Every source query is scoped by `organizationId`, so
another org cannot read/delete/attach a source it does not own — it receives
`SourceNotFoundError` (404) without leaking existence. This invariant is covered
by tests.

## Testing

Following `test/routes/knowledge.test.ts`,
`test/routes/knowledge-versioning-e2e.test.ts`, and existing module-test
conventions (vitest + `test/support/fake-db.ts`).

**Store (`test/modules/knowledge-core/source-repository.test.ts`):**
- `create` generates an `src_...` id, sets `createdAt` / `createdBy`, preserves
  `locator` / `metadata`.
- `findById` is org-scoped — another org gets `null`.
- `findByProject` filters correctly by `projectId` and `type`.
- `delete` returns `true` when removed, `false` when absent.
- No `update` method is exposed (enforced by the store interface).

**Entity / validation (`test/modules/knowledge-core/source-entities.test.ts`):**
- `createSourceBodySchema`: missing `locator` → fail; whitespace-only `locator`
  → fail; `type` outside the enum → fail; `metadata` defaults to `{}` when
  absent; unknown field (`.strict()`) → fail.
- `sourceIdSchema` matches `src_` + 26 Crockford chars; rejects wrong
  prefix/length.

**Source routes (`test/routes/sources.test.ts` + e2e):**
- `POST /sources` valid → 201 with correct body; project missing → 404; bad
  `type` / `locator` → 400; missing bearer → 401.
- `GET /sources/:id` → returns the source; malformed id → 400; missing → 404.
- `GET /sources?projectId=&type=` → filters correctly, shape `{ sources: [...] }`.
- `DELETE /sources/:id` → 204; missing → 404. Confirm **no** cascade (an item
  keeps its now-dangling `sourceId` after the source is deleted).
- Tenant isolation: org B cannot read/delete org A's source → 404.

**Attach / detach (`test/routes/knowledge-*` or a new e2e file):**
- `POST /knowledge/:id/sources` with a valid source → item's `sourceIds`
  contains the id, `version` increments, a new snapshot exists with a
  `changeSummary` like `"attached source ..."`.
- Re-attaching the same `sourceId` → idempotent: no duplicate in `sourceIds`,
  `version` does **not** increment, no new snapshot.
- Attaching a non-existent / cross-org source → 404 (`SourceNotFoundError`).
- Attaching to a non-existent item → 404 (`KnowledgeNotFoundError`).
- `DELETE /knowledge/:id/sources/:sourceId` with an existing link → removed,
  `version` increments, snapshot `"detached source ..."`.
- Detaching a non-existent link → 404 (`SourceNotFoundError`).
- Backward compatibility: an item created before PM-013 (no `sourceIds`) reads
  as `[]` and can be attached to normally.

**Index (`test/lib/indexes.test.ts`):**
- `sources` has `id_unique` (unique) and `project_type`, plus the shared
  `org_project` tenancy index.

Invariants covered: immutability (no source update path), tenant isolation,
attach idempotency, versioning on attach/detach, and accepted dangling
references after deletion.

## Index changes

Add to `CORE_COLLECTION_EXTRA_INDEXES` for `sources` in `src/lib/indexes.ts`:

```ts
sources: [
  { key: { id: 1 }, name: "id_unique", unique: true },
  { key: { organizationId: 1, projectId: 1, type: 1 }, name: "project_type" },
],
```

The shared `org_project` tenancy index already comes from `CORE_COLLECTIONS`.

## Out of scope

- Fact linkage (PM-014) and relation linkage (PM-015).
- An assembled "provenance view" on a knowledge item (Q1 option B, not chosen).
- A source state machine or `PATCH /sources/:id` (sources are near-immutable).
- Cascade cleanup of `sourceIds` when a source is deleted (dangling accepted).
- Per-type metadata validation schemas (light enum-only validation for now).
- Many-to-many reverse lookup ("which items reference this source").
