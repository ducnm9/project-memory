# PM-004 — Authentication & Service Identity — Design

**Status:** Approved for implementation planning
**Date:** 2026-09-18
**Ticket:** PM-004 (Epic 1 — Foundation, milestone M0)
**Depends on:** PM-003 (Organization / Project multi-tenancy) — done
**Followed by:** PM-005 (repository-to-project binding); a later authorization/RBAC ticket

## Purpose

PM-003 established tenant *scoping and enforcement* but explicitly deferred
*authentication*: any well-formed request naming an existing org/project
succeeded, and management endpoints were unauthenticated. PM-004 closes that
gap for the inbound direction. It gives every request an authenticated
`actor` (principal), resolved *before* tenant resolution, and constrains which
organization a caller may operate in.

PM-004 delivers four things:

1. **Service tokens** — PM issues and manages its own bearer credentials
   (`pmk_<random>`), storing only a hash. Each token is bound to exactly one
   organization.
2. **An authentication plugin** that runs before tenant-context, verifies the
   `Authorization: Bearer` credential, and decorates `request.actor`.
3. **Org enforcement** wired into tenant-context: the requested organization
   must match the token's organization, else `403`.
4. **Token management routes** (create / list / revoke), plus org creation,
   gated by an admin bootstrap key.

## Scope decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Deliverable | Inbound authentication only. Establishes the authenticated `actor` for tenant + future authorization to consume. |
| 2 | Mechanism | PM-issued service tokens (`pmk_<random>`), hash stored, `Authorization: Bearer`. No external IdP. |
| 3 | Actor↔tenant binding | Token bound to exactly one org. Middleware forces requested org to match the token's org (project free within the org). |
| 4 | Token lifecycle | Create / list / revoke routes, gated by an admin bootstrap key (env). Soft-revoke. |
| 5 | Actor shape | Minimal: `{ actorId, organizationId, type: "service" }`. Actor *is* the token identity; no separate `actors` collection. |
| 6 | System vs in-org ops | Admin key gates system-level ops (create org, manage tokens). Bearer token gates in-org ops. |
| 7 | No-token policy | Deny-by-default per-route via `config.auth`; default `bearer`. |

## Explicitly out of scope

- **Outbound connector identity** (how PM authenticates to GitHub/Jira/S3) —
  belongs with the ingestion tickets (M4).
- **RBAC / per-operation & per-project authorization** (roles, permissions,
  the general `403` model) — its own authorization ticket. PM-004 does the one
  minimal authorization slice PM-003 named: org matching.
- **OIDC / external IdP / human interactive login** — M5 (Enterprise). The
  token mechanism is the M0 foundation; OIDC layers on later.
- **Actor as a standalone entity** with multiple tokens and human/agent types —
  M5. PM-004's actor is the token identity.
- **Automatic token expiry / rotation** — manual revoke is sufficient at
  foundation stage. Known future addition.
- **Pagination** on token/org/project lists — no volume yet (consistent with
  PM-003).

## Architecture & module boundaries

PM-004 adds a new `auth` module (parallel to `project-context`), one
authentication plugin, one token-management route set, and small edits to
`tenant-context`, `app.ts`, `indexes.ts`, `errors.ts`, and `config`. No
knowledge/retrieval/governance code is touched.

Two parallel authentication mechanisms, one per operation tier:

- **Admin key** (env bootstrap) → system-level ops: create organization,
  create/list/revoke tokens.
- **Bearer token** (per-org) → in-org ops: everything scoped inside one
  organization (today the `/organizations/:orgId/*` project routes; later
  knowledge/retrieval).

Units (each one purpose):

- **`modules/auth/entities.ts`** — `ServiceToken` type + Zod schema. Pure data:
  `{ id, organizationId, name, prefix, hashedSecret, createdAt, revokedAt }`.
  Never stores the plaintext secret.
- **`modules/auth/secret.ts`** — secret generation/hashing. Generates
  `pmk_<random>` (≥32 bytes entropy), hashes via HMAC-SHA-256 with a
  server-side pepper, and compares in constant time. Isolated so the sensitive
  primitive is tested alone. Uses Node's built-in `crypto` — no new dependency.
- **`modules/auth/repository.ts`** — token persistence: `createToken(orgId,
  name)`, `findActiveByHash(hash)`, `listTokens(orgId)`, `revokeToken(orgId,
  tokenId)`. Depends on `Db`. Not tenant-scoped (tokens are an identity root,
  like orgs/projects in PM-003).
- **`modules/auth/actor.ts`** — the `Actor` type (`{ actorId, organizationId,
  type: "service" }`) and `resolveActor(repo, bearer)`: extracts the secret from
  the header, hashes it, looks up the active token, returns an actor or a typed
  error. Transport-agnostic (reusable from the future MCP context).
- **`plugins/authentication.ts`** — Fastify `onRequest` plugin, registered
  *before* `tenant-context`. Reads `request.routeOptions.config.auth` and
  applies the matching policy (public / admin / bearer); for bearer routes it
  runs `resolveActor` and decorates `request.actor`.
- **`routes/tokens.ts`** — create / list / revoke routes, gated by the admin
  key.

Dependency direction: `routes → repository`; `plugin → actor → repository →
mongo`; `actor → secret`. The plugin depends on the HTTP lifecycle; `actor`,
`secret`, and `repository` do not, so all three are reusable from a future
MCP/ingestion context. This mirrors PM-003's `plugin → context → repository`
layering.

## Data model

One new collection `service_tokens`, distinct from the 8 tenant-scoped core
collections and from `organizations`/`projects`. Tokens are an identity root, so
they are not themselves tenant-filtered.

### `service_tokens`

```json
{
  "id": "tok_<ulid>",
  "organizationId": "org_<ulid>",
  "name": "kiro-ci",
  "prefix": "pmk_a1b2c3d4",
  "hashedSecret": "<hex hmac-sha256>",
  "createdAt": "2026-09-18T12:00:00.000Z",
  "revokedAt": null
}
```

Rules:

- **Ids:** prefixed ULID-style (`tok_`), generated server-side, Zod-validated at
  the trust boundary. Reuses the `ulid` dependency already added in PM-003.
- **Secret shape (returned to caller once, at creation):** `pmk_<random>` —
  `pmk_` type prefix (secret-scanner friendly, à la Stripe `sk_`) + ≥32 bytes of
  entropy encoded base62/base64url.
- **`prefix`** stored in DB = `pmk_` + first 8 chars of the random part. Used to
  display a non-secret identifier in list responses (`pmk_a1b2c3d4…`). Not
  enough to reconstruct the secret.
- **`hashedSecret`:** HMAC-SHA-256(secret, pepper), hex. Only the hash is
  stored, never the plaintext.
- **`name`:** required, non-empty, trimmed; **not** unique (the id is the
  identity) — same convention as org/project.
- **`revokedAt`:** `null` when active; set to a timestamp on revoke
  (soft-revoke, no hard delete — preserves the record for future audit).

### Hashing & matching rationale

Service tokens are high-entropy secrets (≥256 bits), unlike user passwords.
Therefore PM-004 uses a **fast keyed hash (HMAC-SHA-256 + server-side pepper),
not bcrypt/argon2**:

- No slow brute-force-resistant KDF is needed for high-entropy secrets; this is
  standard practice for API keys (GitHub, Stripe).
- A fast deterministic hash allows verification in a single query:
  `findOne({ hashedSecret })`.
- The pepper is a server-side secret (env), so a database leak alone does not
  let an attacker precompute matches.
- Matching hashes the incoming secret then looks up by hash value; there is no
  timing side-channel on the secret itself. `secret.ts` still uses
  `crypto.timingSafeEqual` for any direct byte comparison it performs.

### Indexes

Added to the declarative index table in `lib/indexes.ts` (no second indexing
mechanism):

- unique on `service_tokens.id`
- unique on `service_tokens.hashedSecret` (primary verification lookup)
- `service_tokens.organizationId` (list-by-org)

## Request flow

Plugin order in `app.ts`: `error-handler` → **`authentication` (new)** →
`tenant-context` → routes. Authentication runs *before* tenant resolution — the
seam PM-003 was designed to receive.

```
HTTP request
  │  headers: Authorization: Bearer pmk_..., x-organization-id, x-project-id
  ▼
authentication plugin (onRequest, before tenant-context)
  │  read request.routeOptions.config.auth  (default: "bearer")
  │   • "public" → skip, no actor
  │   • "admin"  → require admin key; 401 if missing/wrong; no actor
  │   • "bearer" →
  │        1. read Authorization header
  │             • missing / malformed Bearer      ── 401
  │        2. resolveActor(repo, bearer):
  │             • extract secret, hash (HMAC + pepper)
  │             • findActiveByHash → active token? ── no ─▶ 401 (generic)
  │             • token.revokedAt != null          ── ──▶ 401 (generic)
  │        3. decorate request.actor = { actorId, organizationId, type: "service" }
  ▼
tenant-context plugin (onRequest, PM-003, modified)
  │  4. read x-organization-id (or org path id on management routes)
  │  5. IF request.actor present:
  │        requested org must == actor.organizationId  ── mismatch ─▶ 403
  │        (requested org = x-organization-id on header-scoped routes,
  │         = :orgId path param on bearer-gated /organizations/:orgId/* routes)
  │  6. resolveContext(...) as in PM-003 (org/project exist? belongs to org?) ── 400/404
  │  7. decorate request.projectContext
  ▼
route handler → scopedCollection(db, ..., request.projectContext)  (unchanged)
```

Behaviors:

- **Verify is once, read-once:** one hash + one `findOne`; the actor is attached
  once and reused.
- **Org enforcement** is the minimal authorization slice PM-003 named
  ("constrain which scopes a caller may claim"). Token → exactly one org; the
  requested org must match. Project is free within that org (no per-project
  authorization yet).
- **Generic 401 on verify failure:** the response body does not distinguish
  "token not found" vs "revoked" vs "malformed", so an attacker cannot probe.
- **Revocation takes effect immediately:** verify always checks `revokedAt` —
  this is the concrete defense against the "stale permissions" threat in the
  security doc.
- **Placement of org enforcement:** the org match lives in `tenant-context`
  (reading `request.actor`), not in the authentication plugin, because matching
  the org is a decision *about scope* (the tenant layer), while the auth plugin
  only answers "who are you". This keeps each unit single-purpose.

## No-token policy & per-route auth declaration

Deny-by-default. Each route declares its policy via Fastify route config; the
authentication plugin reads `request.routeOptions.config.auth`:

- **`public`** — no credential. Only `GET /health`.
- **`admin`** — requires the admin key; does not build an actor. Used by
  `POST /organizations` and all `/organizations/:orgId/tokens*` routes.
- **`bearer`** — requires a valid bearer token; builds `request.actor`. Used by
  all in-org routes and every future business route.
- **Default when unspecified:** `bearer`. Forgetting to declare locks a route
  down harder, never open.

This declarative mechanism is chosen over URL string matching because string
matching is fragile as routes are added, and declaring intent at the route
definition makes the protection visible where it is defined.

Route classification for PM-004:

| Route | Policy |
|-------|--------|
| `GET /health` | `public` |
| `POST /organizations` | `admin` |
| `GET /organizations`, `GET /organizations/:orgId` | `bearer` |
| `POST/GET /organizations/:orgId/projects*` | `bearer` |
| `POST/GET/DELETE /organizations/:orgId/tokens*` | `admin` |

> Note: `GET /organizations` (list all orgs) is `bearer`, so it runs org
> enforcement against the caller's token. Because a token is bound to one org,
> this list is only meaningful once broadened by a future authorization model;
> at foundation it effectively returns at most the caller's own org. Creating
> and enumerating orgs across the system is an `admin` concern (`POST
> /organizations` is admin-gated); cross-org read is deferred with RBAC.

## API surface

All JSON. Management routes take org/project from the **path** (you are managing
tenancy/identity, not operating inside a header-scoped request).

### Token management (admin-gated)

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/organizations/:orgId/tokens` | `{ name }` | `201` `{ id, name, prefix, secret }` — **`secret` plaintext, returned once** |
| `GET` | `/organizations/:orgId/tokens` | — | `200` `{ tokens: [{ id, name, prefix, createdAt, revokedAt }] }` — **no secret** |
| `DELETE` | `/organizations/:orgId/tokens/:tokenId` | — | `204`, sets `revokedAt` (soft-revoke) |

- `:orgId` is format-validated (`400`) then resolved for existence (`404`),
  same rules as PM-003. A token is created only for an existing org.
- Revoke is soft (`revokedAt`), never a hard delete — preserves history for
  future audit, and verify already filters `revokedAt != null`.

### Organization management

- `POST /organizations` — now **admin-gated** (was unauthenticated in PM-003).
- Other `/organizations*` and `/organizations/:orgId/projects*` — **bearer-gated**
  with org enforcement.

## Error handling

Reuses `lib/errors.ts` + the `error-handler` plugin. Two new error classes,
following the existing `AppError` shape:

- `UnauthorizedError` → `401`, code `UNAUTHORIZED`
- `ForbiddenScopeError` → `403`, code `FORBIDDEN_SCOPE`

| Case | Status | Body |
|------|--------|------|
| Missing/malformed `Authorization: Bearer` on a bearer route | 401 | `{ error: "unauthorized", message: "missing or malformed credentials" }` |
| Well-formed bearer but token inactive/unknown/revoked | 401 | `{ error: "unauthorized", message: "invalid credentials" }` (generic) |
| `x-organization-id` (or org path id) ≠ token's org | 403 | `{ error: "forbidden_scope", message: "token not permitted for this organization" }` |
| Admin route missing/wrong admin key | 401 | `{ error: "unauthorized", message: "invalid admin credentials" }` |
| (PM-003, unchanged) org/project malformed | 400 | as before |
| (PM-003, unchanged) org/project not found | 404 | generic `tenant_not_found` |

Deliberate distinction: **401 = "I don't know who you are"** (verify failed);
**403 = "I know who you are, but you may not use this organization"** (org
mismatch). Standard HTTP semantics; lets a caller tell "change credential" from
"change scope".

## Configuration

Added to `config/index.ts` following the existing Zod + `NODE_ENV` pattern, and
to `.env.example`:

- **`AUTH_ADMIN_KEY`** — the bootstrap admin credential. **Required in
  production** (server refuses to start if missing); in dev/test an explicit
  default is allowed so tests run without external setup.
- **`AUTH_TOKEN_PEPPER`** — HMAC pepper for token hashing. **Required in
  production**; optional in dev/test (absent → HMAC keyed with an empty pepper,
  so tests are deterministic without configuration).

Fail-fast in production prevents deploying with an unset admin key or an
un-peppered hash.

## Isolation & security guarantees

These become the assertions the tests check:

1. A route without a declared `config.auth` defaults to `bearer`; a missing
   token yields `401`. Forgetting to declare locks down, never opens.
2. Verify failure (unknown / revoked / malformed) yields a generic `401` that
   does not distinguish the reason in the body.
3. A valid bearer whose token org differs from the requested org yields `403`
   and never touches another org's data.
4. Revocation is immediate: a revoked token fails verification on the next
   request.
5. The plaintext secret appears exactly once (the `POST tokens` response); list
   never returns it; the DB stores only the hash.
6. Admin-gated routes never build `request.actor` and cannot be bypassed with an
   ordinary bearer token; bearer-gated routes do not accept the admin key in
   place of a bearer.

## Testing

Uses the existing `vitest` setup; no new framework.

- **secret** — generates a well-formed `pmk_` secret; stable hashing; correct
  match/mismatch; constant-time comparison.
- **actor / repository** — every `resolveActor` branch (active → actor; unknown
  → error; revoked → error); `createToken` / `listTokens` (no secret) /
  `revokeToken`.
- **authentication plugin** — per `config.auth`: `public` skips; `bearer`
  missing/malformed → 401; `bearer` valid → actor; `admin` route requires the
  admin key; unspecified route defaults to `bearer`.
- **org enforcement (modified tenant-context)** — org match → proceeds; org
  mismatch → 403. Must fail loudly if isolation regresses.
- **routes/tokens** — integration: create (201, secret once), list (no secret),
  revoke (soft; token then invalid), wrong admin key → 401.
- **end-to-end** — a full-chain request: bearer + matching org → reaches a
  scoped read; bearer + mismatched org → 403; no bearer → 401.

## Files

- **New:** `modules/auth/{entities,secret,repository,actor}.ts`,
  `plugins/authentication.ts`, `routes/tokens.ts`, plus co-located tests.
- **Modified:** `plugins/tenant-context.ts` (read actor, enforce org),
  `routes/organizations.ts` (attach `config.auth`: create=admin, else=bearer),
  `routes/health.ts` (attach `config.auth: "public"`), `app.ts` (register
  authentication plugin before tenant-context; register token routes),
  `lib/indexes.ts` (add `service_tokens` index specs), `lib/errors.ts`
  (`UnauthorizedError`, `ForbiddenScopeError`), `config/index.ts` +
  `.env.example` (admin key, pepper).
