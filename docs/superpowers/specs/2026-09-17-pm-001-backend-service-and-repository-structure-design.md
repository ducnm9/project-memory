# PM-001 — Backend Service and Repository Structure — Design

**Status:** Approved (design)
**Date:** 2026-09-17
**Backlog item:** PM-001 (Epic 1 — Foundation, Milestone M0)
**Scope:** Pure backend service skeleton and repository structure. No database connectivity (deferred to PM-002).

## 1. Purpose

PM-001 establishes the foundation that every later Project Memory milestone
builds on: a runnable TypeScript/Node backend service using Fastify, plus the
repository code structure and quality conventions that subsequent backlog items
(PM-002+) inherit.

It deliberately delivers only what a foundation needs — a health-checkable
service, configuration, logging, error handling, tests, linting, and CI — while
laying down the subsystem boundaries the target architecture calls for. No
business logic, no storage, no external service integration.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Language / runtime | TypeScript / Node.js |
| 2 | Web framework | Fastify |
| 3 | Scope | Pure skeleton — no DB connection (DB is PM-002) |
| 4 | Repository layout | Top-level `src/`, single-package repo |
| 5 | Tooling baseline | Strict TS, ESLint + Prettier, Vitest, `tsc` build, GitHub Actions CI (lint + typecheck + test) |
| 6 | Config validation | Zod |

## 3. Architecture

Single-package TypeScript service at the repo root. The core structural idea is
separating **app assembly** from **process startup**:

- `src/app.ts` exports `buildApp(config)` returning a configured Fastify
  instance with plugins and routes registered, but **not** listening on a port.
  Tests import this.
- `src/server.ts` is the process entrypoint: loads/validates config, calls
  `buildApp`, starts listening, and wires graceful shutdown.

This `buildApp` / `server` split is the seam between "what the app is" and "how
it runs." It makes the service testable in-memory (no port) and gives later
subsystems a single place to register.

### Repository layout

Existing `docs/`, `specs/`, `examples/`, `diagrams/`, `evaluation/`, `scripts/`,
and `.github/` directories are untouched. New additions:

```
package.json          tsconfig.json      eslint.config.js
.prettierrc           vitest.config.ts   .env.example
src/
  server.ts           # entrypoint: config -> buildApp -> listen + graceful shutdown
  app.ts              # buildApp(config): assemble Fastify, register plugins + routes
  config/
    index.ts          # load + validate env (Zod), export typed AppConfig
  plugins/
    logging.ts        # structured logging setup
    error-handler.ts  # centralized error handling -> consistent error shape
  routes/
    health.ts         # GET /health (liveness), GET /ready (readiness)
  lib/
    errors.ts         # AppError base + typed error subclasses
  modules/            # subsystem seams (README-only placeholders)
    project-context/  knowledge-core/  retrieval/  governance/  ingestion/
test/
  ...                 # mirrors src/
```

Each `modules/*` directory contains only a `README.md` stating that subsystem's
responsibility and the PM backlog item that will implement it. No runtime code;
`modules/*` is not imported by `app.ts` in PM-001. This sets the
repository-structure convention PM-001 owns while staying YAGNI.

## 4. Components & responsibilities

**`config/index.ts`** — Loads environment variables and validates them against a
Zod schema at startup. Exports a typed, frozen `AppConfig`
(`{ port, host, nodeEnv, logLevel }`). Fails fast with a clear message on a
missing or malformed required variable. *Consumers:* `server.ts`, `app.ts`.

**`app.ts` — `buildApp(config): FastifyInstance`** — Pure assembly. Creates the
Fastify instance, registers plugins (logging, error handler) and routes
(health), returns the instance without listening. *Depends on:* `config`,
`plugins/*`, `routes/*`. *Consumers:* `server.ts` and tests.

**`server.ts`** — Process lifecycle only: build config, call `buildApp`,
`listen`, register graceful-shutdown handlers (SIGTERM/SIGINT ->
`app.close()` -> `exit(0)`). No business logic. *Consumers:* none (entrypoint).

**`plugins/logging.ts`** — Configures structured request/response logging via
Fastify's built-in Pino logger, level from config. *Registered by:* `app.ts`.

**`plugins/error-handler.ts`** — A `setErrorHandler` mapping thrown errors to a
consistent JSON shape `{ error: { code, message } }`; maps `AppError` subclasses
to their status codes; logs unexpected errors as 500 without leaking internals.
*Depends on:* `lib/errors`. *Registered by:* `app.ts`.

**`routes/health.ts`** — Registers `GET /health` (liveness) and `GET /ready`
(readiness). In PM-001, `/ready` returns ready with no external checks; the
handler is structured so PM-002 can add a DB ping without reshaping it.
*Registered by:* `app.ts`.

**`lib/errors.ts`** — `AppError` base class (carries `statusCode` +
machine-readable `code`) plus initial subclasses `ValidationError` (400) and
`NotFoundError` (404). Gives the codebase one error vocabulary from the start.
*Consumers:* error handler, future modules.

**`modules/*`** — README-only seams; no runtime code; not imported yet.

## 5. Data flow

### Startup

```
server.ts starts
  -> config/index.ts loads + validates env
       -> on failure: log clear message, exit(1)
       -> on success: frozen AppConfig
  -> buildApp(config)
       -> register logging plugin
       -> register error-handler plugin
       -> register health routes
       -> return FastifyInstance (not listening)
  -> app.listen({ port, host })  -> log "listening on host:port"
  -> register SIGTERM/SIGINT handlers -> app.close() -> exit(0)
```

### Request (health)

```
GET /health -> health handler -> 200 { status: "ok" }
GET /ready  -> readiness handler
            -> PM-001: 200 { status: "ready" } (no external deps)
            -> (PM-002 adds DB ping here; on failure -> 503)
Any handler throws
            -> error-handler plugin
            -> AppError -> its statusCode + { error: { code, message } }
            -> unknown  -> 500 generic message; full error logged server-side
```

The readiness endpoint returns ready-with-no-checks now, but its shape (a place
to aggregate check results) is the seam where PM-002's DB ping and later
dependency checks plug in — no reshaping needed.

## 6. Error handling & configuration

### Configuration

Loaded once at startup from environment variables, validated with Zod, exposed
as a frozen typed `AppConfig`. Fail-fast on missing/malformed required vars.

| Var | Meaning | Default | Required |
|-----|---------|---------|----------|
| `PORT` | HTTP listen port | `3000` | no |
| `HOST` | Bind address | `0.0.0.0` | no |
| `NODE_ENV` | `development` \| `production` \| `test` | `development` | no |
| `LOG_LEVEL` | Pino level (`info`, `debug`, ...) | `info` | no |

All four variables are optional (they have defaults), but any value that is
present is still validated: `PORT` must coerce to a positive integer,
`NODE_ENV` must be one of `development` / `production` / `test`, and `LOG_LEVEL`
must be a valid Pino level. An out-of-range or non-enum value fails fast at
startup rather than silently falling back to the default.

A committed `.env.example` documents these. PM-001 has no secrets (no DB, no
external services); `.env` stays git-ignored (already in `.gitignore`) and no
secret is ever logged. PM-002+ extend this same schema for connection strings.

### Error handling

- `lib/errors.ts` defines `AppError` (`statusCode` + `code`) plus
  `ValidationError` (400) and `NotFoundError` (404) to seed the vocabulary.
- The error-handler plugin produces one shape for every error:
  `{ error: { code, message } }`.
- `AppError` subclasses -> declared status + code. Fastify validation errors ->
  400. Unrecognized -> 500 with a generic client message while the full error
  (stack included) is logged server-side. Internal details never leak.
- Process-level unhandled rejections / uncaught exceptions are logged and trigger
  graceful shutdown, so the process never lingers in a corrupt state.

## 7. Testing

Vitest. Because `buildApp` returns a non-listening Fastify instance, tests use
`app.inject()` (in-memory HTTP simulation) — fast, no real ports.

Test layout mirrors `src/`:

```
test/
  app.test.ts                    # buildApp assembles; routes registered
  config/index.test.ts           # valid env -> typed config; invalid/missing -> fail-fast
  routes/health.test.ts          # GET /health -> 200 ok; GET /ready -> 200 ready
  plugins/error-handler.test.ts  # AppError -> mapped status/shape; unknown -> 500 generic
  lib/errors.test.ts             # AppError subclasses carry correct statusCode/code
```

Guarantees:

- **Health/ready** — `app.inject()` returns documented status codes and bodies;
  doubles as the smoke test that the assembly wires together.
- **Config** — valid env produces the expected typed object; a malformed value
  (e.g. non-numeric `PORT`) throws a clear error (fail-fast contract).
- **Error handler** — a thrown `AppError` yields mapped status and
  `{ error: { code, message } }`; an unknown error yields 500 with a generic
  message and does not leak internals.
- **Errors** — each `AppError` subclass reports the right `statusCode`/`code`.

Approach: TDD — write each test against intended behavior, then implement to
green. Coverage is collected (v8) and reported, but **no hard coverage threshold
gate** in PM-001; the bar is that the suite passes in CI.

## 8. Tooling, CI & hook integration

### Dependencies (exact-pinned at implementation time)

- Runtime: `fastify`, `zod`.
- Dev: `typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`, `eslint`,
  `typescript-eslint`, `prettier`, `@types/node`.

### npm scripts

```
dev        tsx watch src/server.ts
build      tsc -p tsconfig.json          -> dist/
start      node dist/server.js
test       vitest run
test:watch vitest
lint       eslint .
format     prettier --write .
typecheck  tsc --noEmit
check      npm run lint && npm run typecheck && npm run test
```

### TypeScript

`strict: true`, `NodeNext` module resolution, `target` ES2022, `outDir: dist/`.
ESLint + Prettier configured to not conflict.

### CI — new workflow `.github/workflows/backend.yml`

- Path-scoped to `src/**`, `test/**`, `package.json`, `tsconfig.json`, and the
  workflow file — independent of `validate-specs.yml` (scoped to `specs/**`).
  No conflict.
- Steps: checkout -> setup-node (npm cache) -> `npm ci` -> `npm run lint` ->
  `npm run typecheck` -> `npm run test`.

### Pre-commit hook integration

The existing `scripts/hooks/pre-commit` validates JSON (Python-based). It is
**extended, not replaced**: append a step that runs `npm run lint` and
`npm run typecheck` **only when staged files include `src/`, `test/`, or TS
config**. JSON validation stays exactly as-is; TS checks are skipped for
docs/spec-only commits so the hook stays fast.

### .gitignore

Already covers `node_modules/`, `dist/`, `coverage/`, `.env*` — no change needed.

## 9. Out of scope (deferred)

- MongoDB connection, collections, indexes, models (PM-002).
- Organization/project tenancy (PM-003).
- Authentication / service identity (PM-004).
- Repository-to-project binding (PM-005).
- Any subsystem implementation inside `modules/*` (later epics).
- Containerization, coverage-threshold gates, conventional-commit enforcement
  (heavier tooling not selected for M0).

## 10. Definition of done

- `npm ci && npm run build` succeeds; `npm run check` (lint + typecheck + test)
  passes.
- Service starts via `npm run dev` / `npm start` and responds `200` on `/health`
  and `/ready`.
- Config fails fast on invalid env with a clear message.
- Errors return the consistent `{ error: { code, message } }` shape; internals
  never leak.
- New CI workflow runs lint + typecheck + test on backend paths and passes.
- Existing JSON pre-commit and spec-validation behavior remains intact.
- `modules/*` seams exist with README boundaries and no runtime code.
