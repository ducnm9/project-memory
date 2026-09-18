# PM-005 — Repository-to-Project Binding — Design

**Status:** Approved for implementation planning
**Date:** 2026-09-18
**Ticket:** PM-005 (Epic 1 — Foundation, milestone M0)
**Depends on:** PM-003 (Organization / Project multi-tenancy) and PM-004 (Authentication / Service Identity) — both done
**Followed by:** PM-051 (MCP `project.resolve` / `project.bootstrap`); Epic 3 (repository bootstrap, PM-020+); a later authorization/RBAC ticket

## Purpose

PM-005 links a Git repository to a Project so every future ingestion and
retrieval operation has an unambiguous project scope. It is the last Epic-1
(M0) ticket and the seam Epic 3 (bootstrap) and Epic 6 (MCP) build on.

PM-005 delivers three things:

1. **A `Repository` binding entity** — one active binding per
   `(organizationId, normalized repository URL)`, pointing at exactly one
   project.
2. **Binding management routes** (connect / list / unbind), org-nested and
   bearer-gated.
3. **`project.resolve`** — a transport-agnostic resolver that maps a repository
   URL to its project within the caller's organization.

It also delivers one required correctness fix: **PM-004's organization
enforcement does not currently cover `:orgId` path-parameter routes** (see
§2). Because every PM-005 route is an org-nested path route, PM-005 must close
that gap or it would ship a cross-tenant hole.

## Scope decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Deliverable | Binding + `project.resolve`, entirely offline. No outbound network calls. |
| 2 | Cardinality | One repository → one project. A project may hold many repositories. Unique active binding per `(organizationId, url)`. |
| 3 | Route shape | Org-nested: `/organizations/:orgId/...`, consistent with PM-003/PM-004, so tenant enforcement keys off the path. |
| 4 | Unbind | Soft unbind (`unboundAt`); uniqueness is a partial index over active bindings, so a URL can be re-bound. |
| 5 | Cross-tenant gap | Fixed inside PM-005 (§2): tenant-context must enforce the actor org against the `:orgId` path param too. |
| 6 | Authorization | `bearer` only. Any bearer token in the organization may bind/unbind; per-project and role authorization is deferred to the RBAC ticket. |
| 7 | Idempotency | Connecting the same URL to the same project is idempotent (`200`, existing binding). The same URL to a different project is `409`. |

## Explicitly out of scope

- **Outbound repository accessibility / connector identity** — verifying that a
  repository exists and is reachable requires the outbound connector
  credential PM-004 deliberately deferred to M4. PM-005 validates URL *format*
  only.
- **MCP `project.resolve` runtime and JSON schema** — the MCP server has no
  runtime yet (`src/` has no MCP code). PM-005 exposes the resolver as a
  transport-agnostic module function and an HTTP route; PM-051 wires it into
  MCP.
- **Per-project and role-based authorization** — its own ticket. PM-005
  inherits PM-004's org-level enforcement only.
- **Repository analysis, bootstrap, knowledge extraction** — Epic 3 (PM-020+).
- **Updating a binding** (e.g. changing `defaultBranch`) — only create / list /
  resolve / unbind are delivered.
- **Cross-organization listing and pagination** — no volume yet; consistent
  with PM-003/PM-004.
- **Hosting-provider path case-insensitivity** — `github.com/Acme/Widgets` and
  `github.com/acme/widgets` are treated as distinct. Documented normalization
  limitation; revisit if it causes duplicate bindings.

## 1. The cross-tenant enforcement gap (required prerequisite)

PM-004's spec stated that on bearer-gated `/organizations/:orgId/*` routes the
requested organization is the `:orgId` path param. The implementation does not
do that:

- `src/plugins/tenant-context.ts:19-20` reads **only** the `x-organization-id`
  header and `return`s when it is absent.
- `src/plugins/tenant-context.ts:22` performs the actor/org `403` check *after*
  that early return, comparing the actor against the **header** only.
- `src/routes/organizations.ts:52-66` takes the organization from the `:orgId`
  path param and never compares it to `req.actor.organizationId`.

Exploit: a token bound to organization A sends
`GET /organizations/<orgB>/projects` with its valid bearer token and **omits**
`x-organization-id`. Authentication resolves `actor.organizationId = A`;
tenant-context early-returns without checking; the handler lists organization
B's projects. The same omission permits `POST /organizations/<orgB>/projects`.
The test suite never catches this because every test sends the header and, when
it does, the header equals the path.

### Fix

In `src/plugins/tenant-context.ts`, collect **both** claimed organization
identifiers — the `x-organization-id` header (if present) and any `:orgId` path
param (if present) — and reject with `403 FORBIDDEN_SCOPE` when the actor's
organization differs from **any** identifier present. The existing early return
and `resolveContext` call for header-scoped routes are left unchanged, so
org-nested route handlers keep doing their own existence checks.

Properties:

- Minimal, single-choke-point change; it fixes the class of bug for the
  existing project routes as well as every PM-005 route.
- No behavior change for header-scoped routes (the existing tests must keep
  passing unmodified).
- `req.params` is populated before `onRequest` hooks because routing precedes
  the hook; verify this against the Fastify version in use during
  implementation.

## 2. Architecture & module boundaries

PM-005 adds one module, one route file, one root collection, three error
classes, and the tenant-context fix. No knowledge, retrieval, governance, or
ingestion code is touched.

Units (each one purpose):

- **`src/modules/repository-binding/entities.ts`** — the `Repository` type and
  its Zod schemas:   `repoIdSchema` (`/^repo_[0-9A-HJKMNP-TV-Z]{26}$/`),
  `newRepositoryId()` (`repo_` + `ulid()`), the connector enum, and the create
  body schema. Pure data.
- **`src/modules/repository-binding/url.ts`** — `parseRepositoryUrl(input)`.
  Pure URL parsing/normalization and connector inference. No I/O, so it is
  tested alone (mirrors `modules/auth/secret.ts`).
- **`src/modules/repository-binding/repository.ts`** — persistence:
  `createRepositoryStore(db)` returning `createRepository`, `findActiveByUrl`,
  `listActiveByProject`, `markUnbound`. Depends on `Db`; not tenant-scoped (a
  binding is an identity root, like projects).
- **`src/modules/repository-binding/resolver.ts`** —
  `resolveProjectByRepository(store, organizationId, repositoryUrl)`. Depends
  on `url` + `repository`; transport-agnostic and reusable from MCP PM-051.
- **`src/routes/repositories.ts`** — `registerRepositoryRoutes(app)`: the four
  HTTP routes.

Dependency direction: `routes → {resolver, repository} → url`; `repository →
mongo`. `url`, `entities`, `resolver`, and `repository` do not depend on the
HTTP lifecycle, so all four are reusable from a future MCP/ingestion context —
the same layering PM-004 used for `actor`/`secret`/`repository`.

`repositories` is a root collection in `lib/indexes.ts`, alongside
`organizations`, `projects`, and `service_tokens` — not one of the eight
tenant-scoped core collections, and not accessed through `scopedCollection`.

## 3. Data model

One new root collection, `repositories`.

```json
{
  "id": "repo_<ulid>",
  "organizationId": "org_<ulid>",
  "projectId": "proj_<ulid>",
  "url": "https://github.com/acme/widgets",
  "host": "github.com",
  "path": "acme/widgets",
  "connector": "github",
  "defaultBranch": null,
  "createdAt": "2026-09-18T12:00:00.000Z",
  "createdBy": "tok_<ulid>",
  "unboundAt": null
}
```

Rules:

- **`id`** — prefixed ULID (`repo_`), server-generated, format-validated at the
  trust boundary. Reuses the `ulid` dependency added in PM-003.
- **`url`** — the canonical form produced by `parseRepositoryUrl`. This is the
  value uniqueness and lookup are based on; the raw request string is never
  stored.
- **`host` / `path`** — derived by the parser and stored so ingestion (M4) does
  not have to re-parse, and so resolve diagnostics are readable.
- **`connector`** — `github` | `gitlab` | `bitbucket` | `git`. Inferred from
  the host; an explicit value in the request body overrides the inference.
- **`defaultBranch`** — optional; `null` when omitted. The system does not guess
  `main`; ingestion determines the actual default branch later.
- **`createdBy`** — `request.actor.actorId`. Provenance now; the immutable
  `AuditEvent` model (PM-016) consumes it later.
- **`unboundAt`** — `null` while active; set to a timestamp on unbind. Soft, no
  hard delete — preserves history and keeps the partial index correct. An
  unbound row never satisfies resolve or list.

### Indexes

Appended to `ROOT_COLLECTION_INDEXES` in `src/lib/indexes.ts`:

- unique on `repositories.id`
- **unique partial** on `(organizationId, url)` with
  `partialFilterExpression: { unboundAt: null }` — at most one active binding
  per repository per organization; enforces idempotency/conflict at the
  database, not just in application code.
- `(organizationId, projectId)` — list-by-project.

No second indexing mechanism is introduced; `ensureIndexes` merges the table as
today.

## 4. URL normalization

`parseRepositoryUrl(input: string): ParsedRepository | null` accepts:

- `https://host/owner/repo`, `https://host/owner/repo.git`
- `http://host/owner/repo`
- `ssh://git@host/owner/repo.git`
- `git://host/owner/repo.git`
- scp-style `git@host:owner/repo.git`

Canonicalization: lowercase the host; strip userinfo/credentials; strip the
trailing `/`; strip a trailing `.git`; rebuild as `https://<host>/<path>`.
Reject (return `null`, mapped to `400 INVALID_REPOSITORY_URL` by the route) when
there is no host or no path segment. A single-segment path is accepted (a
repository at a host root); deeper paths are preserved as-is.

Connector inference: `github.com` → `github`, `gitlab.com` → `gitlab`,
`bitbucket.org` → `bitbucket`, anything else → `git`. An explicit `connector`
in the request body takes precedence after enum validation.

Path case is preserved (see out-of-scope: provider case-insensitivity).

## 5. Resolver

`resolveProjectByRepository(store, organizationId, repositoryUrl)`:

1. Normalize `repositoryUrl`; `null` → `null`.
2. `store.findActiveByUrl(organizationId, normalizedUrl)`.
3. Return `{ projectId, repositoryId }` or `null`.

Organization-scoped by construction, so it can never return a project in
another organization. It does not read HTTP state, so the same function backs
the HTTP resolve route today and the MCP `project.resolve` tool in PM-051.

Distinguishing `400` from `404` is the caller's job: the resolve route
normalizes the query value first and throws `400 INVALID_REPOSITORY_URL` on a
malformed URL, then calls the resolver; the resolver's own null-on-malformed
branch is defensive only, so a well-formed but unbound URL yields `404`.

## 6. API surface

All JSON. All routes declare `config.auth: "bearer"`; after the §1 fix, PM-004's
org enforcement guarantees `:orgId` equals the actor's organization.

| Method | Path | Body / query | Success | Errors |
|--------|------|--------------|---------|--------|
| `POST` | `/organizations/:orgId/projects/:projectId/repositories` | `{ repositoryUrl, defaultBranch?, connector? }` (`repositoryUrl` required non-empty; `defaultBranch` optional trimmed non-empty; `connector` optional enum) | `201 { ...repository }`; repeat for the same project → `200 { ...repository }` (existing) | `400 INVALID_REPOSITORY_URL`; `404 TENANT_NOT_FOUND` (unknown org/project); `409 REPOSITORY_ALREADY_BOUND` (same URL, different project) |
| `GET` | `/organizations/:orgId/projects/:projectId/repositories` | — | `200 { repositories: [...] }` (active only) | `400` malformed ids; `404 TENANT_NOT_FOUND` |
| `GET` | `/organizations/:orgId/repositories/resolve` | `?repositoryUrl=` | `200 { organizationId, projectId, repositoryId }` | `400 INVALID_REPOSITORY_URL`; `404 REPOSITORY_NOT_FOUND` |
| `DELETE` | `/organizations/:orgId/projects/:projectId/repositories/:repositoryId` | — | `204` (sets `unboundAt`) | `400` malformed ids; `404 REPOSITORY_NOT_FOUND` |

Behaviors:

- **Project existence is checked through `project-context`** (`getProject(orgId,
  projectId)`), not by re-querying the `projects` collection. `project-context`
  owns projects.
- **Idempotency and conflict are applied on both the fast path and the race
  path.** The POST inserts; on a Mongo duplicate-key error (`11000`) it re-reads
  the active binding and applies the same branch: same project → `200`, other
  project → `409`. This makes the unique partial index authoritative under
  concurrency rather than trusting a read-then-write check.
- **Responses return the entity** with `_id` projected out, consistent with
  org/project responses. List wraps in `{ repositories: [...] }`, matching
  `{ projects: [...] }`.
- **Unbind is scoped**: the binding must be active and must belong to the named
  org and project, else `404 REPOSITORY_NOT_FOUND`. After unbind, resolve
  fails and the same URL can be re-bound (to any project in that org).

## 7. Error handling

Reuses `lib/errors.ts` + the `error-handler` plugin. Three new classes,
following the existing `AppError` shape:

- `InvalidRepositoryUrlError` → `400`, code `INVALID_REPOSITORY_URL`
- `RepositoryConflictError` → `409`, code `REPOSITORY_ALREADY_BOUND`
- `RepositoryNotFoundError` → `404`, code `REPOSITORY_NOT_FOUND`

| Case | Status | Code |
|------|--------|------|
| URL missing / unparseable | 400 | `INVALID_REPOSITORY_URL` |
| Malformed `:orgId` / `:projectId` / `:repositoryId` | 400 | `INVALID_TENANT_SCOPE` |
| Unknown organization or project | 404 | `TENANT_NOT_FOUND` |
| Same URL bound to a different project in the org | 409 | `REPOSITORY_ALREADY_BOUND` |
| Resolve miss, or unbind of a non-active binding | 404 | `REPOSITORY_NOT_FOUND` |
| Bearer org ≠ `:orgId` (including header omitted) | 403 | `FORBIDDEN_SCOPE` |

## 8. Configuration

No new configuration. The feature makes no outbound calls and stores no
credentials, so it adds nothing to `config/index.ts` or `.env.example`.

## 9. Isolation & security guarantees

These become the assertions the tests check:

1. A bearer token for organization A cannot create, list, resolve, or unbind a
   binding in organization B — **including when `x-organization-id` is
   omitted** (the regression the §1 fix exists to prevent). This is enforced
   once in tenant-context and must fail loudly if it regresses.
2. At most one active binding exists per `(organizationId, url)`; the unique
   partial index enforces this even under concurrent requests.
3. Connecting the same URL to the same project is idempotent and creates no
   second row.
4. An unbound binding never satisfies resolve or list, and frees the URL for
   re-binding.
5. Resolve never returns a project outside the caller's organization.
6. No outbound network request is made while binding or resolving, and no
   repository credential is stored.

## 10. Testing

Uses the existing `vitest` setup; no new framework.

- **url** — every accepted form (`https`, `http`, `ssh`, `git`, scp-style),
  `.git` and trailing-slash stripping, credential stripping, host lowercasing,
  malformed inputs rejected, connector inference per host, explicit override.
- **repository** (store) — `createRepository` stamps the canonical url and
  identity fields; `findActiveByUrl` ignores unbound rows; `listActiveByProject`
  filters by org and excludes unbound; `markUnbound` sets `unboundAt`.
- **resolver** — match; miss; the same URL in another organization resolves to
  `null`; an unbound binding resolves to `null`.
- **routes** — create `201`; repeat same project `200` idempotent (still one
  row); same URL different project `409`; malformed URL `400`; unknown project
  `404`; list returns active only; resolve `200`/`404`; unbind `204` then
  resolve `404` and re-bind succeeds; duplicate-key race maps to the correct
  `200`/`409` branch.
- **tenant-context regression** — actor org ≠ `:orgId` with **no**
  `x-organization-id` header → `403`; actor org = `:orgId` with no header →
  proceeds. Existing header-scoped tests stay unmodified and passing.
- **end-to-end** — through `buildApp`: bearer token for org A against
  `/organizations/<orgB>/projects/<projectId>/repositories` with no header →
  `403`; matching org → `201`; and a full connect → resolve → unbind → resolve
  sequence.

## 11. Files

- **New:** `src/modules/repository-binding/{entities,url,repository,resolver}.ts`,
  `src/routes/repositories.ts`, plus co-located tests under `test/`.
- **Modified:** `src/plugins/tenant-context.ts` (§1 fix),
  `src/lib/indexes.ts` (repositories root indexes), `src/lib/errors.ts` (three
  error classes), `src/app.ts` (register repository routes),
  `src/modules/project-context/README.md` (the stale "no runtime code here yet"
  note now that PM-003/PM-005 have landed).
