# PM-003 — Organization / Project Multi-Tenancy — Design

**Status:** Approved for implementation planning
**Date:** 2026-09-18
**Ticket:** PM-003 (Epic 1 — Foundation, milestone M0)
**Depends on:** PM-002 (MongoDB setup and tenancy index) — done
**Followed by:** PM-004 (authentication / service identity), PM-005 (repository-to-project binding)

## Security caveat (read first)

PM-003 establishes tenant *scoping and enforcement*, **not authorization**. Any
well-formed request naming an existing organization/project succeeds; PM-003
does not verify the caller is *allowed* to use that scope. Organization and
project management endpoints are likewise unauthenticated. This is a deliberate,
temporary gap closed by **PM-004**, which will run authentication before tenant
resolution and constrain which scopes a caller may claim. The resolution and
enforcement layer built here is designed so PM-004 layers on top without
changing it.

## Purpose

Give every read and write in Project Memory an enforced tenant boundary. PM-003
delivers three things future tickets build on:

1. The `Organization` and `Project` entities, with minimal management endpoints
   to create and list them (these are the roots that all knowledge is scoped to).
2. A request-scoped `ProjectContext` resolved from request headers and validated
   server-side.
3. A reusable, transport-agnostic data-layer helper (`scopedCollection`) that
   makes cross-tenant access structurally impossible for consumers.

Knowledge models, retrieval, ingestion, and governance are out of scope; PM-003
only produces the tenancy plumbing they will later consume.

## Scope decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Deliverable | Entities + context plumbing + enforcement helper. Auth deferred to PM-004. |
| 2 | Scope supply | `x-organization-id` / `x-project-id` request headers, validated + resolved server-side. |
| 3 | Scope tiers | Required `organizationId`; nullable `projectId` (null = organization-shared). Global/cross-org tier deferred. |
| 4 | Enforcement | `scopedCollection` helper returning already-scoped handles; transport-agnostic. |
| 5 | Errors | 400 malformed input; non-leaking 404 unresolvable scope; 403 (authorization) deferred to PM-004. |
| 6 | Entity CRUD | Organization + Project: Create / Get / List. No update/delete (deferred). |

## Architecture & module boundaries

PM-003 lives in the existing `src/modules/project-context` module (currently an
empty stub), plus one cross-cutting data-layer helper and one Fastify plugin.
No existing knowledge/retrieval/governance code is touched.

Units (each one purpose):

- **`modules/project-context/entities.ts`** — `Organization` and `Project`
  types + Zod schemas (shape, id format, timestamps). Pure data definitions.
- **`modules/project-context/repository.ts`** — persistence for orgs/projects
  themselves: `createOrganization`, `getOrganization`, `listOrganizations`,
  `createProject`, `getProject`, `listProjects`. Depends on `Db`. Not
  tenant-scoped (orgs/projects are the tenancy roots), but `getProject`
  enforces the org-ownership check.
- **`modules/project-context/context.ts`** — the `ProjectContext` type
  (`{ organizationId: string; projectId: string | null }`) and
  `resolveContext(repo, headers)` which validates headers, confirms existence
  and org-ownership, and returns a resolved context or a typed error.
- **`lib/scoped-collection.ts`** — the enforcement helper
  `scopedCollection(db, name, ctx)`. Reads apply
  `{ organizationId, projectId: { $in: [ctx.projectId, null] } }`; writes stamp
  the exact `{ organizationId, projectId }`. When `ctx.projectId` is `null`
  (org-shared scope) the read `$in` deduplicates to `[null]`, i.e. org-shared
  records only — this is intended, not a bug. Reusable seam for all future
  core-collection access. Placed in `lib/` (cross-cutting infrastructure,
  alongside `mongo.ts` / `indexes.ts`) because it is transport-agnostic.
- **`plugins/tenant-context.ts`** — Fastify plugin (onRequest hook) that runs
  the resolver, maps failures to 400/404, and decorates
  `request.projectContext`.
- **`routes/organizations.ts`** — the Create/Get/List endpoints for orgs and
  nested projects.

Dependency direction: `routes → plugin → context → repository → mongo`;
`scoped-collection → mongo`. The plugin depends on the HTTP request lifecycle;
the resolver and scoped-collection do not, so both are reusable from the future
MCP/ingestion contexts.

## Data model

Two new collections, distinct from the 8 tenant-scoped core collections. Orgs
and projects are the *roots* of tenancy, so they are not themselves
tenant-filtered.

### `organizations`

```json
{
  "id": "org_<ulid>",
  "name": "Acme Corp",
  "createdAt": "2026-09-18T09:00:00.000Z",
  "updatedAt": "2026-09-18T09:00:00.000Z"
}
```

### `projects`

```json
{
  "id": "proj_<ulid>",
  "organizationId": "org_<ulid>",
  "name": "matter-history",
  "createdAt": "2026-09-18T09:00:00.000Z",
  "updatedAt": "2026-09-18T09:00:00.000Z"
}
```

Rules:

- **Ids:** prefixed ULID-style strings (`org_`, `proj_`), generated server-side.
  (The domain-model doc's `org-1` / `project-1` are illustrative placeholders;
  this design uses real generated ids.) Zod validates the format at the trust
  boundary.
- **Uniqueness:** unique index on `organizations.id` and `projects.id`. Global
  id uniqueness makes a `projects.(organizationId, id)` unique index redundant;
  index `projects.organizationId` for list-by-org queries.
- **`name`:** required, non-empty, trimmed; **not** unique (the id is the
  identity). No slug/description/metadata bag until a consumer needs one.
- **Core collections:** the existing `(organizationId, projectId)` tenancy index
  (PM-002) already covers the 8 core collections. PM-003 adds only the two new
  collection index sets by extending the existing declarative index table in
  `lib/indexes.ts` — no second indexing mechanism.
- **`projectId` nullability** (org-shared) is a property of the *core*
  collections (Epic 2), not the `projects` collection. PM-003 establishes the
  enforcement predicate that honors it.

## Request flow

```
HTTP request
  │  headers: x-organization-id, x-project-id (project optional)
  ▼
tenant-context plugin (onRequest hook)
  │  1. read headers
  │  2. validate format (Zod)                     ── fail ─▶ 400
  │  3. resolveContext(repo, headers)
  │        • org exists?                           ── no ──▶ 404 (non-leaking)
  │        • projectId present?
  │            – yes: project exists AND belongs to org? ── no ─▶ 404
  │            – no:  context = { organizationId, projectId: null }  (org-shared)
  │  4. decorate request.projectContext
  ▼
route handler
  │  const items = scopedCollection(db, "knowledge_items", request.projectContext)
  ▼
scoped-collection helper
     reads  → filter { organizationId, projectId: { $in: [projectId, null] } }
     writes → stamp  { organizationId, projectId }   (exact scope; null if org-shared)
```

Behaviors:

- **`x-project-id` is optional.** Absent → org-shared scope
  (`projectId: null`): reads org-shared records, writes org-shared records.
  Present → project scope: reads its own + org-shared records, writes to its own
  project. This is how the two tiers surface at request time.
- **Project-scoped reads always include org-shared records** (the read filter's
  `$in` always contains `null`). This matches the docs' precedence model
  (project + org-shared both visible); retrieval *ranking* between the tiers is
  a later ticket (Epic 4).
- **Resolution is per-request and read-once**: one lookup, attached once;
  scoped-collection calls reuse the resolved context with no repeated DB hits.
- **No scope override**: `scopedCollection` stamps only the resolved context;
  there is no API to write to a different scope. Isolation is structural.
- The tenant header mechanism is consumed by *future* scoped routes. PM-003
  ships the plugin + helper as the reusable seam and includes one tiny
  end-to-end test of a scoped read to prove the mechanism (not a production
  knowledge route — that is Epic 2).

## Error handling

Reuses the existing `lib/errors.ts` / `error-handler` plugin machinery.

| Case | Status | Body |
|------|--------|------|
| Missing `x-organization-id`, or any header/path id fails format validation | 400 | `{ error: "invalid_tenant_scope", message: "<which header/why>" }` |
| Org id well-formed but org not found | 404 | `{ error: "tenant_not_found", message: "organization or project not found" }` |
| Project not found, **or** project exists but `organizationId` mismatch | 404 | same generic `tenant_not_found` body |
| Valid, resolvable scope | — | proceeds |

- The 400 message may name which header/path id was malformed (caller-fixable
  input validation, not a leak).
- The 404 message is deliberately generic and identical across "org missing,"
  "project missing," and "project belongs to another org," so a caller cannot
  probe which ids exist in other tenants. This is the concrete defense against
  the "cross-project retrieval leakage" threat in the security doc.

## Isolation guarantees

These become the assertions PM-103's isolation tests will check:

1. A resolved `ProjectContext` is the only way to obtain a scoped collection
   handle; there is no API to pass an arbitrary org/project into
   `scopedCollection` other than via a context that passed resolution.
2. Reads from a scoped handle can never return a record whose `organizationId`
   differs from the context — the filter is injected by the helper, not the
   caller.
3. Writes stamp the context's exact scope; a caller cannot write into a
   different org or a sibling project.
4. Requesting a project that belongs to another org resolves to 404, never to
   that project's data.

## API surface

All JSON. Management routes take org/project from the **path**, not the tenant
headers (you are managing tenancy, not operating inside a scope).

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/organizations` | `{ name }` | `201` org |
| `GET` | `/organizations` | — | `200` `{ organizations: [...] }` |
| `GET` | `/organizations/:orgId` | — | `200` org / `404` |
| `POST` | `/organizations/:orgId/projects` | `{ name }` | `201` project / `404` if org missing |
| `GET` | `/organizations/:orgId/projects` | — | `200` `{ projects: [...] }` / `404` if org missing |
| `GET` | `/organizations/:orgId/projects/:projectId` | — | `200` project / `404` |

- Path ids are format-validated (400) then resolved (404), same rules as headers.
- Lists are unpaginated. **Pagination is deferred** — no consumer needs it at
  foundation stage and there is no data volume yet. Known future addition.

## Dependencies

- **`ulid`** — maintained, widely used; pinned to an exact version; used for
  server-side id generation. Behind the entities/repository.
  - Tradeoff: a ~10-line local monotonic generator would avoid the dependency.
    Recommendation is the package (do not reinvent monotonic ULIDs); the local
    generator is the fallback if adding the dependency is undesirable.

## Testing

Uses the existing `vitest` setup; no new framework.

- **entities** — schema validation (id format, required non-empty name).
- **repository / context** — org-ownership check and all resolution paths,
  including the project-belongs-to-another-org → 404 case.
- **scoped-collection** — the injected read filter (includes `null`) and the
  write stamp (exact scope). This test must fail loudly if isolation regresses.
- **plugin/routes** — integration tests over the routes for 400 / 404 / success,
  plus one end-to-end scoped-read test proving the header → context → scoped
  access mechanism.

## Files

- **New:** `modules/project-context/{entities,repository,context}.ts`,
  `lib/scoped-collection.ts`, `plugins/tenant-context.ts`,
  `routes/organizations.ts`, plus co-located tests.
- **Modified:** `lib/indexes.ts` (add `organizations` / `projects` index specs),
  `app.ts` (register plugin + routes), `package.json` (add `ulid`).

## Explicitly out of scope

Authentication and management-endpoint auth (PM-004); repository-to-project
binding (PM-005); knowledge models and CRUD (Epic 2); retrieval ranking
(Epic 4); pagination; org/project update and delete (need Epic 2 knowledge data
to define cascade/soft-delete semantics); global/cross-org tier.
