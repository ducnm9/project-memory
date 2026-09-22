# PM-015 — Relation Model (canonical graph edges)

**Date:** 2026-09-22
**Status:** Approved design, pending implementation plan
**Preceded by:** PM-010 (KnowledgeItem base + CRUD), PM-011 (typed knowledge
contracts), PM-012 (versioning), PM-013 (provenance/sources), PM-014 (Fact model)
**Followed by:** impact analysis (`knowledge.impact`), shared/generic version
store extraction

## Problem

The domain model lists `Relation` as a first-class entity alongside
`KnowledgeItem` and `Fact`. Relations are the canonical graph edges between
knowledge entities — the structure impact analysis traverses to answer "what is
affected if I change X". The domain model defines them as a subject–predicate–object
triple that carries a **fixed initial predicate vocabulary**, plus source,
status, creator, timestamps, and an **optional reviewer**:

> Initial predicates: `depends_on`, `implemented_by`, `defined_by`,
> `related_to`, `supersedes`, `contradicts`, `derived_from`, `documents`,
> `fixes`, `impacts`, `owned_by`. Canonical relations carry source, status,
> creator, timestamps, and optional reviewer.

PM-014 shipped `Fact` as a first-class triple entity with a free-form predicate.
Relation is structurally similar but distinct in two ways: its predicate is a
**closed vocabulary** enforced at the schema boundary, and it records a
**reviewer** — the actor who accepts or rejects the proposed edge. This ticket
adds Relation as a first-class entity with its own collection, repository,
routes, lifecycle, and version store, following the proven Fact template.

## Decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | `predicate` is a **fixed vocabulary** (the 11 domain-model predicates) enforced at the schema boundary. The vocabulary lives in a single exported `RELATION_PREDICATES` constant, so extending it is a one-line edit. Off-vocabulary predicates are rejected with `ValidationError` (400). |
| 2 | Relation records a **`reviewerId`**, auto-stamped from the authenticated actor on the PATCH that moves the relation out of `PROPOSED` (accept/reject). It is never client-settable and never appears in a request body. Self-review is allowed (separation-of-duties is out of scope). |
| 3 | Relation reuses **Fact's compact lifecycle**: `PROPOSED → ACCEPTED \| REJECTED`, `ACCEPTED → DEPRECATED`, with `REJECTED`/`DEPRECATED` terminal. No `VALIDATING` state. |
| 4 | Relation gets **full versioning + source attach/detach**, following the Fact template with a dedicated `relation_versions` store. This is the **third** instance of the version-store pattern; generalization into one shared store is deferred to its own ticket (see `ponytail:` note below). |
| 5 | `subjectId` / `objectId` are **free-form non-empty strings** — no referential integrity, symmetric with Fact. Relations may reference KnowledgeItems, Facts, external component identifiers, or entities not yet ingested. |

## Architecture

Relation is a subsystem parallel to Fact, living in the `knowledge-core` module
and following the existing Fact source/version patterns.

### Versioning approach — dedicated Relation version store

Following PM-014, Relation gets its own version store (`relation_versions`,
keyed by `relationId`) rather than generalizing the existing per-model stores.

`ponytail:` this is the **third** near-identical version-store + version-route
subsystem (`knowledge_versions`, `fact_versions`, now `relation_versions`).
Ceiling: three duplicated version subsystems (~40 lines of store + a route file
each). Upgrade path: extract a single generic version store parameterized by
collection name + owner-id field + snapshot type, and refactor all three models
onto it. That extraction is its **own** ticket — doing it inside PM-015 would
mix a refactor of green, tested code (PM-012, PM-014) into a feature and put
both at risk. Ship Relation on the proven template; pay down the duplication in
a focused follow-up.

### Files

**New — `src/modules/knowledge-core/`:**
- `relation-entities.ts` — `Relation` interface, `RELATION_PREDICATES`,
  `RELATION_STATUSES`, zod schemas (`createRelationBodySchema`,
  `updateRelationBodySchema`, `relationIdSchema`, `relationPredicateSchema`,
  `relationStatusSchema`), `newRelationId()` (`rel_` + ULID).
- `relation-lifecycle.ts` — transition graph, `assertRelationTransition`,
  `canRelationTransition`, `INITIAL_RELATION_STATUS`. (Separate from
  `fact-lifecycle.ts`; identical graph today but its own concern.)
- `relation-repository.ts` — `RelationStore` (create / findById / findByProject
  / update / setSourceIds / delete) over collection `relations`. `reviewerId` is
  folded into the `update` path — `UpdateRelationPatch` includes an optional
  `reviewerId?: string`, so the route stamps it atomically with the status
  change. No separate `setReviewer` method.
- `relation-version-entities.ts` — `RelationVersion` interface,
  `relationVersionIdSchema`, `newRelationVersionId()` (`rver_` + ULID).
- `relation-version-repository.ts` — `RelationVersionStore` (append / listByRelation
  / findByVersion) over collection `relation_versions`.

**New — `src/routes/`:**
- `relations.ts` — CRUD + PATCH + source attach/detach for `/relations`
  (sources folded in, mirroring `facts.ts`).
- `relation-versions.ts` — `/relations/:id/versions`, `/:v`, `/:from/diff/:to`.

**Modified:**
- `src/lib/indexes.ts` — add extra indexes for `relations` (id unique;
  `org+project+predicate`; `org+project+status`) and register `relation_versions`
  with its indexes (id unique; `org+relationId`). (`relations` and
  `relation_versions` are already declared in `CORE_COLLECTIONS`; `relations`
  already exists, `relation_versions` must be added to that list.)
- `src/lib/errors.ts` — add `RelationNotFoundError` (404, `RELATION_NOT_FOUND`).
- `src/app.ts` — register `registerRelationRoutes` and
  `registerRelationVersionRoutes`.

## Data model

### `Relation` entity (collection `relations`)

```ts
export const RELATION_PREDICATES = [
  "depends_on", "implemented_by", "defined_by", "related_to",
  "supersedes", "contradicts", "derived_from", "documents",
  "fixes", "impacts", "owned_by",
] as const;
export type RelationPredicate = (typeof RELATION_PREDICATES)[number];

export const RELATION_STATUSES = ["PROPOSED", "ACCEPTED", "REJECTED", "DEPRECATED"] as const;
export type RelationStatus = (typeof RELATION_STATUSES)[number];

interface Relation {
  id: string;                    // "rel_" + ULID (Crockford base32)
  organizationId: string;
  projectId: string;
  subjectId: string;             // free-form, non-empty
  predicate: RelationPredicate;  // fixed vocabulary
  objectId: string;              // free-form, non-empty
  status: RelationStatus;        // PROPOSED | ACCEPTED | REJECTED | DEPRECATED
  version: number;               // starts at 1, increments on every write
  ownerId: string;               // creating actor
  reviewerId: string | null;     // stamped on PROPOSED → ACCEPTED|REJECTED; else null
  sourceIds: string[];           // attached/detached via sources endpoints
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}
```

All three of `subjectId`, `predicate`, `objectId` are required — a triple
missing an endpoint is not a triple. `objectId` (not `object`/`value`) matches
the domain model's naming, consistent with Fact.

### `RelationVersion` entity (collection `relation_versions`)

Mirrors `FactVersion`:

```ts
interface RelationVersion {
  id: string;              // "rver_" + ULID
  organizationId: string;
  relationId: string;
  version: number;
  snapshot: Relation;
  changedBy: string;
  changedAt: string;
  changeSummary: string;
}
```

### Lifecycle (compact)

```
PROPOSED → ACCEPTED | REJECTED
ACCEPTED → DEPRECATED
REJECTED, DEPRECATED  (terminal)
```

- Creation always starts at `PROPOSED`, `reviewerId: null`. `POST /relations`
  does not accept `status` or `reviewerId`.
- Status changes go through `PATCH /relations/:id`, validated by
  `assertRelationTransition`; an illegal transition raises the existing
  `InvalidStatusTransitionError` (422).
- When a PATCH moves the relation from `PROPOSED` to `ACCEPTED` or `REJECTED`,
  the route stamps `reviewerId` with the authenticated actor in the same update.

### Reviewer stamping (the one behavior unique to Relation)

In the PATCH handler, after `assertRelationTransition` passes: if
`existing.status === "PROPOSED"` and the new status is `ACCEPTED` or `REJECTED`,
include `reviewerId: actor.actorId` in the update patch. `reviewerId` is stamped
exactly once, on the decision edge; later transitions (e.g.
`ACCEPTED → DEPRECATED`) leave it unchanged. It is never accepted from a request
body — the `updateRelationBodySchema` is `.strict()` and does not include it.

### Validation

Because subject/object are free-form and predicate is a closed enum, Relation
has a **fixed shape** and needs no per-type content module.

- `POST /relations` body (strict): `{ projectId, subjectId, predicate, objectId }`.
  `predicate` must be in `RELATION_PREDICATES`. No `status`, `reviewerId`, or
  `sourceIds` at creation.
- `PATCH /relations/:id` body (strict): `{ subjectId?, predicate?, objectId?,
  status?, changeSummary? }`; at least one field required. `predicate` (if
  present) must be in the vocabulary. No `reviewerId`.

## API

All endpoints require bearer auth and tenant context (`x-organization-id`),
mirroring `/facts`.

### `/relations`

| Method | Path | Behavior |
|---|---|---|
| POST | `/relations` | Validate body (predicate in vocabulary) → assert project exists → create (version 1, status `PROPOSED`, `reviewerId` null) → append version snapshot (`"initial version"`) → 201 |
| GET | `/relations/:id` | Return Relation, else `RelationNotFoundError` (404) |
| GET | `/relations` | Filter by `projectId?`, `predicate?`, `status?` → `{ relations: [...] }` |
| PATCH | `/relations/:id` | Validate patch → if `status` changes, `assertRelationTransition`; if leaving `PROPOSED`, stamp `reviewerId` = acting actor → update (bump version) → append version snapshot |
| DELETE | `/relations/:id` | 204, or 404 |
| POST | `/relations/:id/sources` | Assert source exists → attach (idempotent: no bump if already present) → append version |
| DELETE | `/relations/:id/sources/:sourceId` | Detach → append version |

### `/relations/:id/versions`

| Method | Path | Behavior |
|---|---|---|
| GET | `/relations/:id/versions` | `{ versions: [...] }` sorted by version ascending |
| GET | `/relations/:id/versions/:v` | Specific version, else 404 |
| GET | `/relations/:id/versions/:from/diff/:to` | Diff two snapshots, excluding `version` and `updatedAt` |

Every write operation (create, patch, attach/detach source) appends an immutable
snapshot to `relation_versions` with `changedBy` and `changeSummary`. Diff
reuses the same `diffSnapshots` logic as `fact-versions.ts` (excluding
`version`/`updatedAt`).

Query-filter validation matches `facts.ts`: `projectId` is validated with
`projectIdSchema` and asserted to exist; `predicate` filter (if present) is
checked against the vocabulary; `status` filter is parsed with
`relationStatusSchema`. Each invalid filter raises `ValidationError`.

## Error handling

New: `RelationNotFoundError` (404, `RELATION_NOT_FOUND`). Reuse existing
`ValidationError` (400, incl. off-vocabulary predicate), `SourceNotFoundError`,
`InvalidStatusTransitionError` (422), `TenantNotFoundError`,
`InvalidTenantScopeError`, `UnauthorizedError`.

## Testing (TDD)

Each module and route ships with tests following existing Fact patterns:

- `relation-entities` — schema acceptance/rejection, including **off-vocabulary
  predicate rejected**; status transition graph.
- `relation-lifecycle` — legal/illegal transitions; terminal states.
- `relation-repository` — CRUD against the in-memory fake-db.
- `relation-version-repository` — append / listByRelation / findByVersion.
- `relations` routes (e2e) — CRUD, tenancy isolation, status transitions,
  **`reviewerId` null while `PROPOSED` and stamped with the acting actor on
  accept/reject**, source attach/detach idempotency, off-vocabulary predicate
  rejected (400), 404s.
- `relation-versions` routes (e2e) — list/get/diff, version bump per write.

## Out of scope

- Referential integrity between `subjectId`/`objectId` and KnowledgeItems/Facts.
- A shared/generic version store (deferred to its own ticket; `ponytail:` note
  above records the threefold duplication and the extraction path).
- Impact-analysis traversal (`knowledge.impact`) over relation edges.
- Separation-of-duties (preventing a creator from reviewing their own relation).
- MCP `knowledge.record_relation` wiring.
