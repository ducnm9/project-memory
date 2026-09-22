# PM-014 — Fact Model (first-class triples)

**Date:** 2026-09-22
**Status:** Approved design, pending implementation plan
**Preceded by:** PM-010 (KnowledgeItem base + CRUD), PM-011 (typed knowledge
contracts), PM-012 (versioning), PM-013 (provenance/sources)
**Followed by:** PM-015 (relations)

## Problem

The domain model lists `Fact` as a first-class entity alongside `KnowledgeItem`
and `Relation`, shaped as a subject–predicate–object triple with its own status
and source references:

```json
{ "subjectId": "matter-history", "predicate": "depends_on", "objectId": "audit-log", "status": "ACCEPTED", "sourceIds": ["pr-1821"] }
```

Today, PM-011 shipped `Fact` as the seventh `KnowledgeItem` **type** (free-text
`content` with a `{ subject, predicate, object, evidence }` contract). That is a
different concept from the triple entity the domain model describes. PM-014
makes Fact a first-class entity with its own collection, repository, routes, and
lifecycle — and removes the `type: "Fact"` KnowledgeItem path so there is a
single source of truth for Facts.

## Decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | `subjectId` / `objectId` are **free-form string identifiers** — no referential integrity, no validation against KnowledgeItems. |
| 2 | `predicate` is a **free-form non-empty string** — not a fixed enum, not shared with Relation's vocabulary. |
| 3 | The existing `type: "Fact"` KnowledgeItem path is **removed entirely** (option X). `"Fact"` leaves `KNOWLEDGE_TYPES`; the `fact` content schema leaves `contracts.ts`. |
| 4 | Fact uses a **compact status set** (not KnowledgeItem's 9-status machine): `PROPOSED`, `ACCEPTED`, `REJECTED`, `DEPRECATED`. |
| 5 | Fact has **full versioning + source attachment**, consistent with KnowledgeItem (option b). |

## Architecture

Fact is a subsystem parallel to KnowledgeItem, living in the `knowledge-core`
module and following the existing source/knowledge patterns.

### Versioning approach — dedicated Fact version store (1a)

The current version store is coupled to `KnowledgeItem`: `KnowledgeVersion.snapshot`
is typed `KnowledgeItem`, `AppendVersionInput.snapshot: KnowledgeItem`, and it
writes to `knowledge_versions` keyed by `knowledgeId`. Rather than generalize a
green, in-use system (risking PM-012 regressions), Fact gets its own version
store mirroring the pattern.

`ponytail:` deliberate duplication of the version-store pattern (~40 lines) and
the version-route pattern. Ceiling: two near-identical version subsystems.
Upgrade path: generalize into one shared, generic version store when a **third**
model needs versioning.

### Files

**New — `src/modules/knowledge-core/`:**
- `fact-entities.ts` — `Fact` interface, `FACT_STATUSES`, zod schemas
  (`createFactBodySchema`, `updateFactBodySchema`, `factIdSchema`), `newFactId()`.
- `fact-lifecycle.ts` — `FACT_STATUSES` transition graph, `assertFactTransition`,
  `canFactTransition`. (Kept separate from `lifecycle.ts` because the graph
  differs; mirrors that file's shape.)
- `fact-repository.ts` — `FactStore` (create / findById / findByProject / update
  / setSourceIds / delete) over collection `facts`.
- `fact-version-entities.ts` — `FactVersion` interface, `factVersionIdSchema`,
  `newFactVersionId()` (`fver_` + ULID).
- `fact-version-repository.ts` — `FactVersionStore` (append / listByFact /
  findByVersion) over collection `fact_versions`.

**New — `src/routes/`:**
- `facts.ts` — CRUD + PATCH + source attach/detach for `/facts` (sources folded
  in, mirroring how `knowledge.ts` folds in `/knowledge/:id/sources`).
- `fact-versions.ts` — `/facts/:id/versions`, `/:v`, `/:from/diff/:to`.

**Modified:**
- `src/modules/knowledge-core/entities.ts` — remove `"Fact"` from `KNOWLEDGE_TYPES`.
- `src/modules/knowledge-core/contracts.ts` — remove the `fact` schema and its
  `CONTENT_SCHEMAS.Fact` entry.
- `src/lib/indexes.ts` — add extra indexes for `facts` (id unique;
  `org+project+status`; `org+project+predicate`) and register `fact_versions`
  with its indexes (id unique; `org+factId`).
- `src/lib/errors.ts` — add `FactNotFoundError` (404, `FACT_NOT_FOUND`).
- `src/app.ts` — register `registerFactRoutes` and `registerFactVersionRoutes`.
- Tests currently using `type: "Fact"` as a convenience payload (~8–10 files) —
  switch to `type: "Concept"` with `content: { definition: "..." }`.

## Data model

### `Fact` entity (collection `facts`)

```ts
interface Fact {
  id: string;                 // "fact_" + ULID (Crockford base32)
  organizationId: string;
  projectId: string;
  subjectId: string;          // free-form, non-empty
  predicate: string;          // free-form, non-empty
  objectId: string;           // free-form, non-empty
  status: FactStatus;         // PROPOSED | ACCEPTED | REJECTED | DEPRECATED
  version: number;            // starts at 1, increments on every write
  ownerId: string;            // creating actor
  sourceIds: string[];        // attached/detached via sources endpoints
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}
```

All three of `subjectId`, `predicate`, `objectId` are required — a triple
missing an endpoint is not a triple. `objectId` (not `object`/`value`) matches
the domain model's naming.

### Lifecycle (compact)

```
PROPOSED → ACCEPTED | REJECTED
ACCEPTED → DEPRECATED
REJECTED, DEPRECATED  (terminal)
```

- Creation always starts at `PROPOSED`. `POST /facts` does not accept a `status`.
- Status changes go through `PATCH /facts/:id` and are validated by
  `assertFactTransition`; an illegal transition raises the existing
  `InvalidStatusTransitionError` (422).

### Validation

Because subject/predicate/object are free-form strings, Fact has a **fixed
shape** and does not need a `contracts.ts`-style per-type content module.
Validation lives entirely in the Fact body schemas:

- `POST /facts` body (strict): `{ projectId, subjectId, predicate, objectId }`.
  No `status`, no `sourceIds` at creation.
- `PATCH /facts/:id` body (strict): `{ subjectId?, predicate?, objectId?,
  status?, changeSummary? }`; at least one field required.

## API

All endpoints require bearer auth and tenant context (`x-organization-id`).

### `/facts`

| Method | Path | Behavior |
|---|---|---|
| POST | `/facts` | Validate body → assert project exists → create (version 1, status `PROPOSED`) → append version snapshot (`"initial version"`) → 201 |
| GET | `/facts/:id` | Return Fact, else `FactNotFoundError` (404) |
| GET | `/facts` | Filter by `projectId?`, `predicate?`, `status?` → `{ facts: [...] }` |
| PATCH | `/facts/:id` | Validate patch → if `status` changes, `assertFactTransition` → update (bump version) → append version snapshot |
| DELETE | `/facts/:id` | 204, or 404 |
| POST | `/facts/:id/sources` | Assert source exists → attach (idempotent: no bump if already present) → append version |
| DELETE | `/facts/:id/sources/:sourceId` | Detach → append version |

### `/facts/:id/versions`

| Method | Path | Behavior |
|---|---|---|
| GET | `/facts/:id/versions` | `{ versions: [...] }` sorted by version ascending |
| GET | `/facts/:id/versions/:v` | Specific version, else 404 |
| GET | `/facts/:id/versions/:from/diff/:to` | Diff two snapshots, excluding `version` and `updatedAt` |

Every write operation (create, patch, attach/detach source) appends an immutable
snapshot to `fact_versions` with `changedBy` and `changeSummary`. Diff reuses
the same `diffSnapshots` logic as `knowledge-versions.ts` (excluding
`version`/`updatedAt`).

## Removing the `type: "Fact"` KnowledgeItem path

After `"Fact"` leaves `KNOWLEDGE_TYPES`, `POST /knowledge` with `type: "Fact"`
is rejected by the existing `InvalidKnowledgeTypeError` (422) — no extra code
needed. Unrelated tests that used `type: "Fact"` purely as a valid sample
payload switch to `type: "Concept"` with `content: { definition: "..." }`
(Concept's minimal contract).

## Error handling

New: `FactNotFoundError` (404, `FACT_NOT_FOUND`). Reuse existing
`ValidationError`, `SourceNotFoundError`, `InvalidStatusTransitionError`,
`TenantNotFoundError`, `InvalidTenantScopeError`, `UnauthorizedError`.

## Testing (TDD)

Each module and route ships with tests following existing patterns:
- `fact-entities` — schema acceptance/rejection; status transition graph.
- `fact-repository` — CRUD against the in-memory fake-db.
- `fact-version-repository` — append/list/findByVersion.
- `facts` routes (e2e) — CRUD, tenancy isolation, status transitions, source
  attach/detach idempotency, 404s.
- `fact-versions` routes (e2e) — list/get/diff, version bumps per write.
- Update `entities`/`contracts` tests to reflect the removal of `"Fact"`.
- Update the ~8–10 unrelated tests to use `Concept` payloads.

## Out of scope

- Referential integrity between `subjectId`/`objectId` and KnowledgeItems.
- A shared/generic version store (deferred until a third model needs versioning).
- Relations (PM-015), even though they share a similar triple shape.
- MCP `knowledge.record_fact` wiring.
