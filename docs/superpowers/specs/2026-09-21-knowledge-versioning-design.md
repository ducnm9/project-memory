# Knowledge Versioning — Design Spec

- **Date:** 2026-09-21
- **Issue:** [PM-012] Knowledge versioning (`epic:knowledge-core`, milestone M0)
- **Status:** Approved for planning

## Summary

Every successful update to a `KnowledgeItem` records an immutable version
snapshot, preserving full history. A new `knowledge_versions` collection stores
one append-only document per version. Creation records version 1; each
successful `PATCH` increments the item's `version` and appends a new snapshot.
Three read endpoints expose the history: list versions, fetch one version, and
diff two versions.

This work also closes an existing gap: the current `PATCH /knowledge/:id` does
**not** increment `version` and keeps no history at all.

## Scope decisions (from brainstorming)

- **When to snapshot:** every successful `PATCH` that changes the item (option A).
  "Approved update" is read as "successful PATCH" — governance is not yet a real
  gate in this codebase.
- **What the snapshot captures:** the **new** state after the update (option A).
  Version N = the full item as it stands at version N.
- **v1 timing:** written at `POST /knowledge` (create), not lazily.
- **`changeSummary` source:** caller-provided if present; otherwise auto-generated
  from the changed field names (e.g. `"changed: content, status"`). On create, the
  fixed value `"initial version"`.
- **Diff:** dedicated endpoint, top-level field comparison.
- **`from == to` in diff:** returns `changes: {}` (valid, empty), not an error.
- **Storage:** separate append-only `knowledge_versions` collection (not embedded
  array, not a generic replayable event log).

## Data model

New entity `KnowledgeVersion` in `src/modules/knowledge-core/version-entities.ts`:

```ts
export interface KnowledgeVersion {
  id: string;              // "kver_" + ULID
  organizationId: string;  // tenant scope, consistent with every other collection
  knowledgeId: string;     // references KnowledgeItem.id
  version: number;         // matches KnowledgeItem.version at capture time
  snapshot: KnowledgeItem; // full image of the item at this version
  changedBy: string;       // actor.actorId
  changedAt: string;       // ISO timestamp
  changeSummary: string;   // caller | auto-generated | "initial version"
}
```

Details:

- `id` uses prefix `kver_` + ULID, matching the `know_` style. Add
  `newKnowledgeVersionId()`.
- `organizationId` is stored so every version query is tenant-scoped, consistent
  with all existing repositories.
- `snapshot` is the entire `KnowledgeItem` (including `version`, `updatedAt`,
  etc.) — satisfies "fetching a specific version returns the exact snapshot".
- The pair `(knowledgeId, version)` is unique. `version` is monotonically
  increasing and never reused.
- `changeSummary` is added as an **optional** field on
  `updateKnowledgeItemBodySchema`, but it is **not** a field of `KnowledgeItem`:
  it is consumed to write the version record and stripped from the patch actually
  applied to the item.

## Repository & write path

New repository `src/modules/knowledge-core/version-repository.ts`:

```ts
export interface KnowledgeVersionStore {
  append(input: AppendVersionInput): Promise<KnowledgeVersion>;
  listByKnowledge(
    organizationId: string,
    knowledgeId: string,
  ): Promise<KnowledgeVersion[]>; // sorted by version ascending
  findByVersion(
    organizationId: string,
    knowledgeId: string,
    version: number,
  ): Promise<KnowledgeVersion | null>;
}
```

- Collection `knowledge_versions`, projection `{ _id: 0 }` like other repos.
- `append` only inserts (no update, no delete) — guarantees immutability.

Change to existing `KnowledgeItemStore` (`repository.ts`):

- `update` uses `$set` for the patch **and** `$inc: { version: 1 }` in the same
  `findOneAndUpdate`, returning the document after the change (carrying the new
  `version`). The new version number is thus an atomic DB result, never computed
  in the app layer — this avoids a race where two concurrent patches assign the
  same version.

Create flow (`POST /knowledge`):

1. Create item with `version: 1` (as today).
2. `versionStore.append(...)` with `version: 1`, `changeSummary: "initial version"`,
   `changedBy: actor.actorId`, `snapshot` = the created item.

Update flow (`PATCH /knowledge/:id`):

1. Existing validation (status transition, content validation).
2. Strip `changeSummary` from the patch; if absent, auto-generate it from the
   remaining changed keys (e.g. `"changed: content, status"`).
3. `store.update(...)` with `$set` + `$inc version` → receive the new item
   (already carrying the incremented version).
4. `versionStore.append(...)` with `snapshot` = the new item and `version` = the
   new version.

**Atomicity / ordering.** The item is updated before the snapshot is appended,
because the version number is produced by the DB `$inc` and must be known before
writing the snapshot. There is no multi-document transaction, so if the process
dies between step 3 and step 4, the item is at version N but the version-N
snapshot is missing from history.

> `ponytail:` ceiling — no transaction, a crash between update and append can
> drop one snapshot. Upgrade path — Mongo multi-document transaction on a replica
> set. Chosen as safer than app-layer version management.

## API endpoints

All use `BEARER` auth and are tenant-scoped by `organizationId`, matching
existing routes.

### `GET /knowledge/:id/versions`

- Validate `id` via `knowledgeIdSchema`.
- Confirm the item exists → else `KnowledgeNotFoundError` (404).
- Return `{ versions: [...] }` sorted by `version` ascending.
- Acceptance: after 3 patches → 4 entries (v1 + 3).

### `GET /knowledge/:id/versions/:v`

- Validate `id`; parse `:v` as an integer ≥ 1 (else `ValidationError`, 400).
- `findByVersion(...)`; not found → 404.
- Return the full `KnowledgeVersion` (including `snapshot`).

### `GET /knowledge/:id/versions/:from/diff/:to`

- Validate `id`; parse `from` and `to` as integers ≥ 1.
- Load both versions; either missing → 404.
- Compare top-level fields of the two `snapshot`s. Return:

```json
{
  "from": 2,
  "to": 4,
  "changes": {
    "summary": { "from": "...", "to": "..." },
    "content": { "from": {}, "to": {} }
  }
}
```

- Only include fields that differ. Object fields (e.g. `content`) are deep-compared
  to decide whether they changed, but returned whole (old/new object), not
  key-by-key.
- Excluded from the diff: `updatedAt` (always changes per version write) and
  `version` (it is the comparison axis itself).
- `from == to` → `changes: {}` (empty, valid response).

**Route registration.** Static `/knowledge/:id/versions` and existing
`/knowledge/:id` differ in path-segment count, so Fastify does not confuse them;
declaration order is kept explicit anyway.

`DELETE` and other existing endpoints are unchanged, except that `POST`/`PATCH`
now also write a version.

## Error handling

Reuse existing errors in `src/lib/errors.ts` (no new error types):

- Malformed `id` → `ValidationError` (400)
- `:v` / `:from` / `:to` not an integer ≥ 1 → `ValidationError` (400)
- Item not found, or version not found → `KnowledgeNotFoundError` (404)
- Missing credentials → `UnauthorizedError` (401)

## Testing

Following `test/routes/knowledge.test.ts` and `knowledge-e2e.test.ts` conventions:

- Create item → version 1 exists with `changeSummary: "initial version"`.
- After 3 patches → `GET .../versions` returns 4 entries, `version` increments 1→4
  (acceptance criterion).
- `GET .../versions/2` returns the exact snapshot at that time (old values, not
  current).
- Caller-provided `changeSummary` is preserved; when omitted it is auto-generated
  (`"changed: ..."`).
- Diff between two versions returns only changed fields, with from/to; `from == to`
  → `changes: {}`.
- Tenant scope: another org cannot read versions of an item it does not own.
- Errors: malformed id (400), missing version (404), missing bearer (401).
- Immutability: patching does not overwrite or drop earlier versions; `version` is
  never reused.

## Out of scope

- Governance approval gate (no real gate exists yet).
- Generic `AuditEvent` log / event replay (separate PM work).
- Reverting an item to a previous version (not requested).
- Deep per-key diff of `content` (top-level only for now).
