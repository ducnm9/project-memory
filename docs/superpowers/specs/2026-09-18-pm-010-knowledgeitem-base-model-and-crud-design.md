# PM-010 — KnowledgeItem Base Model and CRUD — Design

**Status:** Approved for implementation planning
**Date:** 2026-09-18
**Ticket:** PM-010 (Epic 2 — Knowledge Core, milestone M0)
**Depends on:** PM-001 (service structure), PM-002 (MongoDB + indexes), PM-003 (tenancy), PM-004 (authentication), PM-005 (repository binding) — all done
**Followed by:** PM-011 (typed knowledge contracts), PM-012 (versioning), PM-013 (provenance/sources), PM-014/015 (facts/relations), PM-016 (audit), PM-045 (proposal lifecycle)

## Purpose

PM-010 introduces the canonical `KnowledgeItem` — the semantic record every
later knowledge-core ticket builds on (facts, relations, versions, provenance,
retrieval, proposals). It is the first runtime code in `src/modules/knowledge-core`.

PM-010 delivers four things:

1. **The `KnowledgeItem` model** — a typed entity plus write schemas, with the
   `type` enum and base fields validated at the trust boundary.
2. **A lifecycle state machine** — the domain status graph enforced as a pure,
   transport-agnostic module.
3. **A tenant-scoped MongoDB repository** — `create`, `findById`,
   `findByProject`, `update`, `delete`, all organization-scoped.
4. **CRUD HTTP routes** — `POST /knowledge`, `GET /knowledge/:id`,
   `GET /knowledge`, `PATCH /knowledge/:id`, `DELETE /knowledge/:id`.

## Scope decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | HTTP surface | Full CRUD (create/read/list/update/delete) over HTTP, not just the two GETs named in the ticket |
| 2 | Status machine | The literal domain graph; `REJECTED`, `UPDATED`, `STALE`, `DEPRECATED` are terminal |
| 3 | Delete | Hard delete, organization-scoped, `204` |
| 4 | Tenant scope | `x-organization-id` header (tenant-context) + required `projectId` in the create body; optional `projectId` list filter |
| 5 | Initial status | Default `DISCOVERED`; only `PROPOSED` may be supplied as an explicit alternative |
| 6 | Entity types | The ticket's six: `Decision`, `Concept`, `Procedure`, `Troubleshooting`, `Investigation`, `Architecture`. `Fact` is **not** a `KnowledgeItem` type here — it is PM-014 |
| 7 | Content validation | `content` is opaque JSON in PM-010; the per-type contracts are PM-011 |
| 8 | Version | Starts at `1`; PM-010 does not increment it — revisioning is PM-012 |

## Explicitly out of scope

- **Typed content contracts** — required fields per knowledge type (`Decision`
  needs `decision`, etc.) are PM-011. PM-010 stores `content` as an opaque
  object and validates only the base fields. PM-011 plugs validators into the
  same create/update call site.
- **Version history and revision increments** — the `Version` collection and
  version bumping are PM-012. `version` is stored and returned but stays `1`.
- **Provenance / `Source` documents** — PM-013. `GET /knowledge/:id` returns
  the item's own provenance-bearing fields (`ownerId`, `version`, timestamps);
  a `sources` array is added later.
- **Facts and relations** — PM-014 / PM-015. They are separate collections.
- **Immutable audit events** — PM-016.
- **Proposal / review / publish workflow** — PM-045 and the governance ticket.
  PM-010's `POST /knowledge` is a base-model write; ADR-006's proposal gate is
  enforced later.
- **Search representations, embeddings, retrieval** — Epic 4 (PM-030+).
- **MCP tools** — Epic 6 (PM-052 / PM-053).
- **Pagination and sorting** — no volume yet; list returns natural order.
  Consistent with PM-003 / PM-005.
- **Project-level and role-based authorization** — bearer tokens are
  organization-scoped only; per-project authorization is a later RBAC ticket.
  PM-010 inherits PM-004's organization enforcement.

## 1. Architecture & module boundaries

PM-010 adds one module, one route file, two error classes, and per-collection
indexes. No retrieval, governance, ingestion, or repository-binding code is
touched.

Units (each one purpose):

- **`src/modules/knowledge-core/entities.ts`** — the `KnowledgeItem` interface,
  the `KNOWLEDGE_TYPES` and `KNOWLEDGE_STATUSES` constants, the id schema
  (`/^know_[0-9A-HJKMNP-TV-Z]{26}$/`), `newKnowledgeItemId()` (`know_` +
  `ulid()`), and the create / patch body Zod schemas. Pure data.
- **`src/modules/knowledge-core/lifecycle.ts`** — the status state machine:
  `INITIAL_STATUSES`, `TRANSITIONS`, `canTransition(from, to)`,
  `assertTransition(from, to)`. No I/O, tested alone (mirrors
  `modules/auth/secret.ts` and `modules/repository-binding/url.ts`).
- **`src/modules/knowledge-core/repository.ts`** — persistence:
  `createKnowledgeItemStore(db)` returning `create`, `findById`,
  `findByProject`, `update`, `delete`. Depends on `Db`. Every query includes
  `organizationId`.
- **`src/routes/knowledge.ts`** — `registerKnowledgeRoutes(app)`: the five HTTP
  routes, composing `entities` + `lifecycle` + the `project-context`
  repository.

Dependency direction: `routes → {repository → lib/mongo, lifecycle, entities}`
and `routes → modules/project-context`. `entities`, `lifecycle`, and
`repository` do not depend on the HTTP lifecycle, so they are reusable from a
future ingestion or governance context — the same layering PM-004/PM-005 used.

### Why not `lib/scoped-collection.ts`

`scopedCollection` is deliberately **not** used here:

- Its read predicate is `projectId ∈ {ctx.projectId, null}`. PM-010 list needs
  "all items in the organization (optionally filtered by one project)", which
  that predicate cannot express at organization scope.
- Its `insertOne` overwrites `projectId` with the request context value, but
  PM-010's create takes `projectId` from the body (decision 4), so the stamping
  would discard the validated value.
- It exposes no `updateOne` / `deleteOne`.

Extending it would change shared semantics for every future caller. PM-010 owns
an explicit tenant-scoped store instead; `scopedCollection` remains for the
retrieval module, where a concrete project scope is always in hand.

## 2. Data model

One existing core collection, `knowledge_items` (already declared in
`CORE_INDEXES`).

```json
{
  "id": "know_<ulid>",
  "organizationId": "org_<ulid>",
  "projectId": "proj_<ulid>",
  "type": "Decision",
  "title": "Use AuditLog v2 for Matter History",
  "summary": "Matter History uses the standardized audit schema.",
  "content": {},
  "status": "DISCOVERED",
  "version": 1,
  "ownerId": "tok_<ulid>",
  "createdAt": "2026-09-18T12:00:00.000Z",
  "updatedAt": "2026-09-18T12:00:00.000Z",
  "lastVerifiedAt": null
}
```

Rules:

- **`id`** — prefixed ULID (`know_`), server-generated, format-validated at the
  trust boundary. Reuses the `ulid` dependency from PM-003.
- **`organizationId`** — from the request's tenant context, never from the
  body. This is the tenant key for every query.
- **`projectId`** — required in the create body; format-validated and checked
  to exist in the organization through `project-context` (`getProject`).
  Immutable after create.
- **`type`** — one of the six enum values. Immutable after create.
- **`title` / `summary`** — required, trimmed, non-empty. No length cap in
  PM-010 (Fastify's body limit bounds payload size).
- **`content`** — arbitrary JSON object; defaults to `{}` when omitted.
  Opaque in PM-010 (PM-011 validates per type).
- **`status`** — one of the nine lifecycle values. On create, only
  `DISCOVERED` (default) or `PROPOSED`. On update, only a legal transition.
- **`version`** — always `1`; PM-012 increments it and records history.
- **`ownerId`** — `request.actor.actorId`. Immutable.
- **`createdAt` / `updatedAt`** — ISO-8601 strings; `createdAt` immutable,
  `updatedAt` refreshed on each successful `PATCH`.
- **`lastVerifiedAt`** — always `null` in PM-010; freshness (PM-044) sets it.

### Indexes

Appended to `src/lib/indexes.ts` for `knowledge_items`, alongside the existing
`org_project` tenancy index:

- unique on `id` (`id_unique`)
- `(organizationId, projectId, type)` (`project_type`)
- `(organizationId, projectId, status)` (`project_status`)

`CORE_INDEXES` currently maps every core collection to `[TENANCY_INDEX]`; it
gains a per-collection extras table so `knowledge_items` receives these three
without changing the other seven collections. `ensureIndexes` still merges the
root table as today.

## 3. Lifecycle state machine

```text
DISCOVERED  → PROPOSED
PROPOSED    → VALIDATING
VALIDATING  → REJECTED | ACCEPTED
ACCEPTED    → PUBLISHED
PUBLISHED   → UPDATED | STALE | DEPRECATED
```

- Allowed edges are exactly the ones drawn.
- Terminal: `REJECTED`, `UPDATED`, `STALE`, `DEPRECATED`.
- `INITIAL_STATUSES` = `{ DISCOVERED, PROPOSED }` — the only values accepted on
  create.
- `canTransition(from, from)` is **false** — the machine has no self-edges. The
  route treats a `PATCH` whose `status` equals the item's current status as a
  no-op (skips the machine and returns `200`); any other non-edge value is
  rejected.

`assertTransition(from, to)` throws `InvalidStatusTransitionError`
(`422 INVALID_STATUS_TRANSITION`). The machine is exhaustive over the nine
statuses; an unknown status cannot arise because the write schema is a Zod
enum.

PM-012 may later add re-publish edges (`UPDATED → PUBLISHED`,
`STALE → PUBLISHED`); PM-010 deliberately ships the literal graph.

## 4. Repository

`createKnowledgeItemStore(db)` exposes:

```ts
create(input: CreateKnowledgeItemInput): Promise<KnowledgeItem>
findById(organizationId: string, id: string): Promise<KnowledgeItem | null>
findByProject(organizationId: string, filter: {
  projectId?: string; type?: KnowledgeType; status?: KnowledgeStatus;
}): Promise<KnowledgeItem[]>
update(organizationId: string, id: string, patch: UpdateKnowledgeItemPatch): Promise<KnowledgeItem | null>
delete(organizationId: string, id: string): Promise<boolean>
```

- Reads project `_id` out, matching org/project/repository responses.
- `findById` filters `{ id, organizationId }`; a row in another organization is
  indistinguishable from a missing row.
- `update` uses `findOneAndUpdate` with `{ id, organizationId }` and
  `returnDocument: "after"`; returns `null` when nothing matched.
- `delete` uses `deleteOne` with `{ id, organizationId }`; returns whether one
  document was removed.
- The store is persistence-only. Payload validation (base fields, type enum,
  lifecycle transition) happens before it is called.

## 5. API surface

All routes are JSON and declare `config.auth: "bearer"`. Organization scope
comes from the `x-organization-id` header through the existing tenant-context
plugin, which already returns `403 FORBIDDEN_SCOPE` when the actor's
organization does not match the header (including the omission case fixed in
PM-005). Because these routes carry no `:orgId` path param, that header check is
the only organization check needed.

| Method | Path | Body / query | Success | Errors |
|--------|------|--------------|---------|--------|
| `POST` | `/knowledge` | `{ projectId, type, title, summary, content?, status? }` | `201 { ...item }` | `400 VALIDATION_ERROR` (missing/malformed fields, bad ids); `404 TENANT_NOT_FOUND` (unknown project); `422 INVALID_KNOWLEDGE_TYPE`; `422 INVALID_STATUS_TRANSITION` |
| `GET` | `/knowledge/:id` | — | `200 { ...item }` | `400 VALIDATION_ERROR` (malformed id); `404 KNOWLEDGE_NOT_FOUND` (missing or other org) |
| `GET` | `/knowledge` | `?projectId=&type=&status=` — all optional | `200 { items: [...] }` | `400 VALIDATION_ERROR`; `404 TENANT_NOT_FOUND` (unknown `projectId`) |
| `PATCH` | `/knowledge/:id` | `{ title?, summary?, content?, status? }` | `200 { ...item }` | `400 VALIDATION_ERROR` (empty/ malformed patch); `404 KNOWLEDGE_NOT_FOUND`; `422 INVALID_STATUS_TRANSITION` |
| `DELETE` | `/knowledge/:id` | — | `204` | `400 VALIDATION_ERROR`; `404 KNOWLEDGE_NOT_FOUND` |

Behaviors:

- **Organization context is required.** If `x-organization-id` is absent the
  tenant-context plugin leaves `projectContext` undefined; the route rejects
  with `400 INVALID_TENANT_SCOPE`. (Malformed/unknown organization is handled
  by the plugin's `resolveContext`.)
- **Project existence is checked through `project-context`**, not by querying
  the `projects` collection. `POST` verifies the body `projectId`; the list route
  verifies a supplied `?projectId=`. Both map an unknown project to
  `404 TENANT_NOT_FOUND`.
- **`type` and `status` filters are enum-validated**; an invalid filter value is
  `400 VALIDATION_ERROR`, not a silent empty result.
- **`PATCH` is field-partial**; at least one recognized field is required, else
  `400`. Immutable fields (`id`, `organizationId`, `projectId`, `type`,
  `ownerId`, `version`, `createdAt`, `lastVerifiedAt`) are rejected if present
  in the body. The patch schema is `.strict()`, so unknown keys are `400`.
- **Responses return the entity**, consistent with org/project/repository
  responses. List wraps in `{ items: [...] }`, matching `{ projects: [...] }`.
- **`GET /knowledge/:id` is the item with its provenance fields**, since no
  `Source` documents exist yet (PM-013).

## 6. Error handling

Reuses `lib/errors.ts` + the `error-handler` plugin. Additions:

- `KnowledgeNotFoundError` → `404`, code `KNOWLEDGE_NOT_FOUND`
- `InvalidKnowledgeTypeError` → `422`, code `INVALID_KNOWLEDGE_TYPE`
- `InvalidStatusTransitionError` → `422`, code `INVALID_STATUS_TRANSITION`

The existing `ValidationError` (`400 VALIDATION_ERROR`) covers malformed ids,
missing fields, and bad filters. No new `400` class is introduced.

| Case | Status | Code |
|------|--------|------|
| Malformed `:id`, missing/malformed body field, bad `?type=`/`?status=` filter | 400 | `VALIDATION_ERROR` |
| Missing `x-organization-id` | 400 | `INVALID_TENANT_SCOPE` |
| Unknown/malformed organization or project | 404 | `TENANT_NOT_FOUND` |
| Knowledge item missing, or in another organization | 404 | `KNOWLEDGE_NOT_FOUND` |
| `type` not in the enum | 422 | `INVALID_KNOWLEDGE_TYPE` |
| Illegal create status or illegal transition | 422 | `INVALID_STATUS_TRANSITION` |
| Actor org ≠ `x-organization-id` | 403 | `FORBIDDEN_SCOPE` |

## 7. Configuration

No new configuration. The feature makes no outbound calls, stores no
credentials, and adds nothing to `config/index.ts` or `.env.example`.

## 8. Isolation & security guarantees

These become the assertions the tests check:

1. Every read, update, and delete is filtered by `organizationId`; an item that
   exists in another organization is indistinguishable from a missing item
   (`404`).
2. A bearer token for organization A cannot read, list, update, or delete
   organization B's knowledge items — **including when `x-organization-id` is
   omitted or set to B** (PM-004/PM-005 enforcement).
3. `organizationId` and `ownerId` are always server-derived from the request
   context; a client-supplied value is ignored.
4. An item cannot be created without `projectId` and `type`, and the project
   must belong to the caller's organization.
5. Only legal lifecycle edges are writable; e.g. `PUBLISHED → DISCOVERED` is
   `422`, and `REJECTED`/`UPDATED`/`STALE`/`DEPRECATED` are terminal.
6. `content` is stored verbatim and never interpreted in PM-010; no outbound
   network request is made.

## 9. Testing

Uses the existing `vitest` setup; no new framework and no Mongo test server —
tests use the same in-memory fake `Db` pattern as the PM-005 end-to-end test.

- **lifecycle** — every legal edge returns true; representative illegal edges
  (`PUBLISHED → DISCOVERED`, `DISCOVERED → PUBLISHED`, any transition out of a
  terminal state) return false; `canTransition(x, x)` is false;
  `assertTransition` throws `422` with code `INVALID_STATUS_TRANSITION`;
  `INITIAL_STATUSES` is exactly `{ DISCOVERED, PROPOSED }`.
- **entities** — id schema accepts `know_<ulid>` and rejects other prefixes;
  create schema applies defaults (`content = {}`, `status = DISCOVERED`),
  rejects an unknown `type`, rejects an initial status outside the initial set,
  rejects missing `projectId`/`type`/`title`/`summary`; patch schema is strict
  and rejects immutable fields.
- **repository** — `create` stamps server fields and returns the entity;
  `findById` is org-scoped and ignores other organizations; `findByProject`
  applies `projectId`/`type`/`status` filters and never crosses organizations;
  `update` returns the updated doc and `null` for a foreign org; `delete`
  removes only in-org rows and reports `true`/`false`.
- **routes** — `201` create with defaults; `422` unknown type; `422` bad initial
  status; `400` missing `projectId`; `404` unknown project; `GET /:id`
  `200`/`404`/`400`; list filters by `projectId`/`type`/`status` and rejects a
  bad filter enum; `PATCH` updates fields, returns `422` on an illegal
  transition, `404` for another org, `400` on an empty or unknown-key patch;
  `DELETE` then `GET` → `404`; missing `x-organization-id` → `400`.
- **end-to-end** — through `buildApp`: a bearer token for org A against org B's
  item → `403`; a full create → get → list-filter → patch-status (legal and
  illegal) → delete cycle within the caller's org.

## 10. Files

- **New:** `src/modules/knowledge-core/{entities,lifecycle,repository}.ts`,
  `src/routes/knowledge.ts`, plus co-located tests under `test/`.
- **Modified:** `src/lib/errors.ts` (three error classes),
  `src/lib/indexes.ts` (per-collection extras; `knowledge_items` indexes),
  `src/app.ts` (register knowledge routes),
  `src/modules/knowledge-core/README.md` (drop the "no runtime code here yet"
  note now that PM-010 has landed).
