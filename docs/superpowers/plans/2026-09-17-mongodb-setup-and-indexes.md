# MongoDB Setup and Indexes (PM-002) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the official MongoDB driver into the Fastify backend with fail-fast connection at boot, an idempotent index-bootstrap mechanism seeding shared tenancy indexes, and a real DB ping behind `/ready`.

**Architecture:** A small `mongo` lib module owns the driver lifecycle (connect, ping, close). A separate `indexes` lib module holds a declarative collection→index table and an idempotent `ensureIndexes(db)` that later model tickets extend. `server.ts` connects, runs `ensureIndexes`, then injects the live `db` into `buildApp`, which decorates the Fastify instance so routes (notably `/ready`) can use it. Connection/index failure at boot propagates to the existing top-level `catch` and exits non-zero; a runtime ping failure returns 503 without crashing.

**Tech Stack:** TypeScript (ESM, NodeNext), Fastify 5, official `mongodb` driver 7.6.0, Zod for config, Vitest for tests. No ODM — Zod remains the single validation layer.

**Spec:** This plan implements the in-chat bounded design agreed in the PM-002 brainstorming session (driver choice A, index scope B, boot behavior A). No separate spec file exists; the design summary is reproduced in "Design Summary" below so executors have the full contract.

## Global Constraints

- Node runtime floor: `>=20.19.0` (required by `mongodb@7.6.0`). Update `package.json` `engines.node` to `>=20.19.0`.
- Pin dependencies exactly (no `^`/`~`). New dependency: `mongodb` at exactly `7.6.0`.
- ESM only: all relative imports use the `.js` extension (e.g. `./config/index.js`), matching NodeNext + existing code.
- Do not add an ODM (no Mongoose). Zod is the only validation layer.
- Config uses Zod `safeParse` and fails fast with a thrown `Error` on invalid/missing values — match the existing `loadConfig` pattern exactly.
- Unit tests must not require a live MongoDB. Use in-memory fakes/stubs for `db`.
- Core collection names (snake_case), fixed for this ticket: `knowledge_items`, `facts`, `relations`, `sources`, `versions`, `proposals`, `audit_events`, `knowledge_gaps`.
- Shared tenancy index for every core collection: `{ organizationId: 1, projectId: 1 }`, name `org_project`.
- Every task ends green: `npm run lint && npm run typecheck && npm run test` (a.k.a. `npm run check`) must pass before commit.

## Design Summary (verbatim contract)

- **Dependency:** add `mongodb@7.6.0` to `dependencies`. No other new deps.
- **Config:** add required non-empty `MONGODB_URI` and `MONGODB_DB_NAME` to the Zod schema, `AppConfig`, the frozen return object, and `.env.example`.
- **`src/lib/mongo.ts`:** `createMongo(config)` → connects a `MongoClient`, returns `{ client, db }`, throws on failure. `ping(db)` → `db.command({ ping: 1 })`. `closeMongo(client)` for shutdown.
- **`src/lib/indexes.ts`:** declarative table mapping the 8 core collections to index specs (PM-002 = the `org_project` tenancy index each). `ensureIndexes(db)` iterates and calls `createIndexes` per collection; idempotent, safe on every boot. Later tickets append specialized indexes here.
- **Wiring:** `buildApp` takes an injected connected `db` and decorates the instance (`app.decorate("db", db)`). `server.ts`: `createMongo` → `ensureIndexes(db)` → `buildApp({ config, db })` → `listen`; shutdown also calls `closeMongo`.
- **`/ready`:** calls `ping(db)`; 200 `{ status: "ready" }` on success, 503 `{ status: "not ready" }` on failure.
- **Error handling:** boot failure → existing top-level `catch` exits non-zero; runtime ping failure → 503, no crash.
- **Out of scope:** entity schema/models, specialized per-entity indexes, vector/text search indexes, migrations tooling.

---

## File Structure

- **Modify** `package.json` — add `mongodb` dep, bump `engines.node`.
- **Modify** `src/config/index.ts` — add `MONGODB_URI`, `MONGODB_DB_NAME` to schema + `AppConfig` + return object.
- **Modify** `.env.example` — document the two new vars.
- **Create** `src/lib/mongo.ts` — driver lifecycle: `createMongo`, `ping`, `closeMongo`.
- **Create** `src/lib/indexes.ts` — `CORE_INDEXES` table + `ensureIndexes(db)`.
- **Modify** `src/app.ts` — `buildApp` accepts `{ config, db }`, decorates `db`, keeps route registration.
- **Modify** `src/routes/health.ts` — `/ready` pings the decorated `db`.
- **Modify** `src/server.ts` — connect → ensure indexes → build → listen; close on shutdown.
- **Modify** `test/config/index.test.ts` — cover the two new required vars.
- **Create** `test/lib/mongo.test.ts` — `ping`/`closeMongo` against a fake db/client.
- **Create** `test/lib/indexes.test.ts` — `ensureIndexes` against a recording fake db.
- **Modify** `test/routes/health.test.ts` — `/ready` 200/503 with fake db.
- **Modify** `test/app.test.ts` — `buildApp` now needs a `db`; provide a fake.

Fastify type augmentation for the `db` decorator lives inline in `src/app.ts` via `declare module "fastify"`.

---

### Task 1: Add the mongodb dependency and raise the Node floor

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `mongodb@7.6.0` available to import; `engines.node` = `>=20.19.0`.

- [ ] **Step 1: Add the dependency and bump the engine**

Edit `package.json`. In `engines`, change `"node": ">=20"` to `"node": ">=20.19.0"`. In `dependencies`, add `mongodb` between `fastify` and `zod` (keep alphphabetical-ish grouping; exact placement is cosmetic):

```json
  "dependencies": {
    "fastify": "5.1.0",
    "mongodb": "7.6.0",
    "zod": "3.23.8"
  },
```

- [ ] **Step 2: Install to update the lockfile**

Run: `npm install`
Expected: `package-lock.json` updated, `node_modules/mongodb` present, exit 0. (Peer deps `socks`, `snappy`, `kerberos`, etc. are optional and can be ignored — they are auth/compression extras we do not use.)

- [ ] **Step 3: Verify the driver imports and typechecks**

Run: `node -e "require('mongodb')" 2>/dev/null || node --input-type=module -e "import('mongodb').then(()=>console.log('ok'))"`
Expected: prints `ok` (ESM dynamic import resolves).

Then run: `npm run typecheck`
Expected: PASS (no code uses it yet; this confirms the install did not break types).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add mongodb 7.6.0 driver and raise node floor to 20.19"
```

---

### Task 2: Add MongoDB config to the Zod schema

**Files:**
- Modify: `src/config/index.ts`
- Modify: `.env.example`
- Test: `test/config/index.test.ts`

**Interfaces:**
- Consumes: existing `loadConfig(env)` and `AppConfig`.
- Produces: `AppConfig` gains `mongodbUri: string` and `mongodbDbName: string`; both required (throw if missing/empty).

- [ ] **Step 1: Write the failing tests**

Add these cases to `test/config/index.test.ts`. Note the existing "applies defaults when env is empty" test calls `loadConfig({})` and will now throw — update it to supply the required Mongo vars. Replace the first test and add three new ones:

```typescript
  it("applies defaults when env has only required vars", () => {
    const cfg = loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm" });
    expect(cfg.port).toBe(3000);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.nodeEnv).toBe("development");
    expect(cfg.logLevel).toBe("info");
    expect(cfg.mongodbUri).toBe("mongodb://localhost:27017");
    expect(cfg.mongodbDbName).toBe("pm");
  });

  it("fails fast when MONGODB_URI is missing", () => {
    expect(() => loadConfig({ MONGODB_DB_NAME: "pm" })).toThrow(/MONGODB_URI/);
  });

  it("fails fast when MONGODB_DB_NAME is missing", () => {
    expect(() => loadConfig({ MONGODB_URI: "mongodb://localhost:27017" })).toThrow(/MONGODB_DB_NAME/);
  });

  it("fails fast when MONGODB_URI is empty", () => {
    expect(() => loadConfig({ MONGODB_URI: "", MONGODB_DB_NAME: "pm" })).toThrow(/MONGODB_URI/);
  });
```

Also update the other existing tests that call `loadConfig({...})` without Mongo vars (`reads and coerces provided values`, `returns a frozen object`, and each `fails fast on ...` case) so they still exercise their intended failure. For the pattern tests that must reach a *specific* failure (e.g. `PORT: "abc"`), add the Mongo vars so only the intended field is invalid:

```typescript
  it("reads and coerces provided values", () => {
    const cfg = loadConfig({
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "pm",
      PORT: "8080",
      NODE_ENV: "production",
      LOG_LEVEL: "debug",
    });
    expect(cfg.port).toBe(8080);
    expect(cfg.nodeEnv).toBe("production");
    expect(cfg.logLevel).toBe("debug");
  });

  it("returns a frozen object", () => {
    const cfg = loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm" });
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("fails fast on non-numeric PORT", () => {
    expect(() =>
      loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm", PORT: "abc" }),
    ).toThrow(/PORT/);
  });

  it("fails fast on out-of-enum NODE_ENV", () => {
    expect(() =>
      loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm", NODE_ENV: "staging" }),
    ).toThrow(/NODE_ENV/);
  });

  it("fails fast on invalid LOG_LEVEL", () => {
    expect(() =>
      loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm", LOG_LEVEL: "verbose" }),
    ).toThrow(/LOG_LEVEL/);
  });

  it("fails fast on empty HOST", () => {
    expect(() =>
      loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm", HOST: "" }),
    ).toThrow(/HOST/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/config/index.test.ts`
Expected: FAIL — new assertions reference `cfg.mongodbUri`/`cfg.mongodbDbName` (undefined) and the missing-var cases don't throw yet.

- [ ] **Step 3: Implement the config changes**

In `src/config/index.ts`, add the fields to the `AppConfig` interface:

```typescript
export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
  logLevel: string;
  mongodbUri: string;
  mongodbDbName: string;
}
```

Add to the Zod schema (inside the `z.object({...})`):

```typescript
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1),
```

Add to the frozen return object:

```typescript
    mongodbUri: data.MONGODB_URI,
    mongodbDbName: data.MONGODB_DB_NAME,
```

- [ ] **Step 4: Update `.env.example`**

Append to `.env.example`:

```bash
# MongoDB connection string (required). e.g. mongodb://localhost:27017
MONGODB_URI=mongodb://localhost:27017
# MongoDB database name (required).
MONGODB_DB_NAME=project_memory
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- test/config/index.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add src/config/index.ts .env.example test/config/index.test.ts
git commit -m "feat(config): require MONGODB_URI and MONGODB_DB_NAME"
```

---

### Task 3: Mongo driver lifecycle module

**Files:**
- Create: `src/lib/mongo.ts`
- Test: `test/lib/mongo.test.ts`

**Interfaces:**
- Consumes: `AppConfig` from `../config/index.js` (fields `mongodbUri`, `mongodbDbName`).
- Produces:
  - `createMongo(config: AppConfig): Promise<{ client: MongoClient; db: Db }>` — connects, returns handles, throws on connect failure.
  - `ping(db: Db): Promise<void>` — runs `db.command({ ping: 1 })`; rejects if the command fails.
  - `closeMongo(client: MongoClient): Promise<void>` — closes the client.
  - Re-exports the `Db` and `MongoClient` types from `mongodb` for downstream imports.

Note: `createMongo` opens a real socket, so it is not unit-tested here (it is exercised at boot). `ping` and `closeMongo` accept injected handles and ARE unit-tested with fakes.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/mongo.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Db, MongoClient } from "mongodb";
import { closeMongo, ping } from "../../src/lib/mongo.js";

describe("ping", () => {
  it("resolves when the ping command succeeds", async () => {
    const db = { command: vi.fn().mockResolvedValue({ ok: 1 }) } as unknown as Db;
    await expect(ping(db)).resolves.toBeUndefined();
    expect(db.command).toHaveBeenCalledWith({ ping: 1 });
  });

  it("rejects when the ping command fails", async () => {
    const db = { command: vi.fn().mockRejectedValue(new Error("no conn")) } as unknown as Db;
    await expect(ping(db)).rejects.toThrow("no conn");
  });
});

describe("closeMongo", () => {
  it("closes the client", async () => {
    const client = { close: vi.fn().mockResolvedValue(undefined) } as unknown as MongoClient;
    await closeMongo(client);
    expect(client.close).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/lib/mongo.test.ts`
Expected: FAIL with cannot resolve `../../src/lib/mongo.js` (module not created yet).

- [ ] **Step 3: Implement `src/lib/mongo.ts`**

```typescript
import { MongoClient, type Db } from "mongodb";
import type { AppConfig } from "../config/index.js";

export type { Db, MongoClient } from "mongodb";

/**
 * Connects a MongoClient using the configured URI and returns the client plus
 * the target database handle. Throws if the initial connection fails
 * (fail-fast at boot).
 */
export async function createMongo(config: AppConfig): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(config.mongodbUri);
  await client.connect();
  const db = client.db(config.mongodbDbName);
  return { client, db };
}

/** Runs a ping command; rejects if the database is unreachable. */
export async function ping(db: Db): Promise<void> {
  await db.command({ ping: 1 });
}

/** Closes the client during graceful shutdown. */
export async function closeMongo(client: MongoClient): Promise<void> {
  await client.close();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/lib/mongo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mongo.ts test/lib/mongo.test.ts
git commit -m "feat(mongo): add driver lifecycle helpers (createMongo, ping, closeMongo)"
```

---

### Task 4: Idempotent index bootstrap

**Files:**
- Create: `src/lib/indexes.ts`
- Test: `test/lib/indexes.test.ts`

**Interfaces:**
- Consumes: a `Db`-shaped handle (only `.collection(name).createIndexes(specs)` is used).
- Produces:
  - `CORE_INDEXES: ReadonlyArray<{ collection: string; indexes: IndexSpec[] }>` — the declarative table. `IndexSpec` matches the driver's `IndexDescription` shape: `{ key: Record<string, 1 | -1>; name: string }`.
  - `ensureIndexes(db: Db): Promise<void>` — iterates `CORE_INDEXES` and calls `db.collection(c).createIndexes(indexes)` for each. Idempotent (driver no-ops existing indexes).

- [ ] **Step 1: Write the failing tests**

Create `test/lib/indexes.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { CORE_INDEXES, ensureIndexes } from "../../src/lib/indexes.js";

const EXPECTED_COLLECTIONS = [
  "knowledge_items",
  "facts",
  "relations",
  "sources",
  "versions",
  "proposals",
  "audit_events",
  "knowledge_gaps",
];

describe("CORE_INDEXES", () => {
  it("covers every core collection with the org_project tenancy index", () => {
    const names = CORE_INDEXES.map((e) => e.collection);
    expect(names.sort()).toEqual([...EXPECTED_COLLECTIONS].sort());
    for (const entry of CORE_INDEXES) {
      const tenancy = entry.indexes.find((i) => i.name === "org_project");
      expect(tenancy, `${entry.collection} missing org_project`).toBeDefined();
      expect(tenancy?.key).toEqual({ organizationId: 1, projectId: 1 });
    }
  });
});

describe("ensureIndexes", () => {
  it("creates the declared indexes on each collection exactly once", async () => {
    const createIndexes = vi.fn().mockResolvedValue(["org_project"]);
    const collection = vi.fn().mockReturnValue({ createIndexes });
    const db = { collection } as unknown as Db;

    await ensureIndexes(db);

    expect(collection).toHaveBeenCalledTimes(CORE_INDEXES.length);
    for (const entry of CORE_INDEXES) {
      expect(collection).toHaveBeenCalledWith(entry.collection);
    }
    expect(createIndexes).toHaveBeenCalledTimes(CORE_INDEXES.length);
  });

  it("propagates a createIndexes failure", async () => {
    const createIndexes = vi.fn().mockRejectedValue(new Error("index build failed"));
    const collection = vi.fn().mockReturnValue({ createIndexes });
    const db = { collection } as unknown as Db;

    await expect(ensureIndexes(db)).rejects.toThrow("index build failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/lib/indexes.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/indexes.js`.

- [ ] **Step 3: Implement `src/lib/indexes.ts`**

```typescript
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
] as const;

/**
 * Declarative index table. PM-002 seeds the shared tenancy index on every core
 * collection. Later model tickets append their specialized indexes here.
 */
export const CORE_INDEXES: ReadonlyArray<CollectionIndexes> = CORE_COLLECTIONS.map(
  (collection) => ({ collection, indexes: [TENANCY_INDEX] }),
);

/**
 * Ensures all declared indexes exist. `createIndexes` is idempotent: it is a
 * no-op for indexes that already exist, so this is safe to run on every boot.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  for (const { collection, indexes } of CORE_INDEXES) {
    await db.collection(collection).createIndexes(indexes as IndexDescription[]);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/lib/indexes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes.ts test/lib/indexes.test.ts
git commit -m "feat(indexes): idempotent bootstrap of shared tenancy indexes"
```

---

### Task 5: Inject the db into buildApp and decorate Fastify

**Files:**
- Modify: `src/app.ts`
- Test: `test/app.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `Db` (from `./lib/mongo.js`).
- Produces: `buildApp(opts: { config: AppConfig; db: Db }): FastifyInstance`. The instance is decorated with `db: Db` (accessible as `app.db` and `request.server.db`). Route registration unchanged.

Note: this task changes `buildApp`'s signature, so both `test/app.test.ts` (updated here) and `src/server.ts` (updated in Task 7) depend on it. If executing strictly in order, `npm run typecheck` will flag `server.ts`'s stale `buildApp(config)` call until Task 7 rewrites it. That is expected: run only the scoped test in Step 4 to gate this task, and defer the full `npm run typecheck`/`npm run check` gate to Task 7 (Step 2) and Task 8. Do not touch `server.ts` here — its full boot sequence lands in Task 7 as one coherent change.

- [ ] **Step 1: Write the failing test**

Replace the body of `test/app.test.ts` so `buildApp` receives a fake db:

```typescript
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";

function fakeDb(): Db {
  return { command: async () => ({ ok: 1 }) } as unknown as Db;
}

function testConfig() {
  return loadConfig({
    LOG_LEVEL: "silent",
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_DB_NAME: "pm",
  });
}

describe("buildApp", () => {
  it("assembles an app that serves health routes", async () => {
    const app = buildApp({ config: testConfig(), db: fakeDb() });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("decorates the instance with the db", async () => {
    const db = fakeDb();
    const app = buildApp({ config: testConfig(), db });
    expect(app.db).toBe(db);
    await app.close();
  });

  it("wires the error handler for unknown errors", async () => {
    const app = buildApp({ config: testConfig(), db: fakeDb() });
    app.get("/boom", async () => {
      throw new Error("should not leak");
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("INTERNAL_ERROR");
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/app.test.ts`
Expected: FAIL — `buildApp` still takes a single `config` arg; `app.db` is undefined / type error.

- [ ] **Step 3: Implement the `buildApp` change**

Rewrite `src/app.ts`:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config/index.js";
import type { Db } from "./lib/mongo.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerHealthRoutes } from "./routes/health.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
}

export function buildApp({ config, db }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  app.decorate("db", db);

  registerErrorHandler(app);
  registerHealthRoutes(app);

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/app.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts test/app.test.ts
git commit -m "feat(app): inject and decorate mongo db on the fastify instance"
```

---

### Task 6: `/ready` pings the database

**Files:**
- Modify: `src/routes/health.ts`
- Test: `test/routes/health.test.ts`

**Interfaces:**
- Consumes: `app.db` decoration (from Task 5), `ping` from `../lib/mongo.js`.
- Produces: `/ready` → 200 `{ status: "ready" }` when `ping` resolves; 503 `{ status: "not ready" }` when it rejects. `/health` unchanged.

- [ ] **Step 1: Write the failing tests**

Rewrite `test/routes/health.test.ts`. The test app must provide a `db` decoration and register the routes; build it via a small local helper that mirrors production wiring:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { registerHealthRoutes } from "../../src/routes/health.js";

function buildTestApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerHealthRoutes(app);
  return app;
}

const okDb = () => ({ command: async () => ({ ok: 1 }) }) as unknown as Db;
const badDb = () =>
  ({
    command: async () => {
      throw new Error("unreachable");
    },
  }) as unknown as Db;

describe("health routes", () => {
  it("GET /health returns 200 ok", async () => {
    const app = buildTestApp(okDb());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("GET /ready returns 200 ready when the db ping succeeds", async () => {
    const app = buildTestApp(okDb());
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
    await app.close();
  });

  it("GET /ready returns 503 not ready when the db ping fails", async () => {
    const app = buildTestApp(badDb());
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "not ready" });
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/routes/health.test.ts`
Expected: FAIL — `/ready` currently always returns 200 ready and ignores the db.

- [ ] **Step 3: Implement the `/ready` change**

Rewrite `src/routes/health.ts`:

```typescript
import type { FastifyInstance, FastifyReply } from "fastify";
import { ping } from "../lib/mongo.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));

  // Readiness aggregates dependency checks. PM-002: ping MongoDB; 503 on failure.
  app.get("/ready", async (_req, reply: FastifyReply) => {
    try {
      await ping(app.db);
      return { status: "ready" };
    } catch (err) {
      app.log.warn({ err }, "readiness check failed: mongo ping");
      reply.status(503);
      return { status: "not ready" };
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/routes/health.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/routes/health.ts test/routes/health.test.ts
git commit -m "feat(health): /ready pings mongodb and returns 503 on failure"
```

---

### Task 7: Wire the boot sequence in server.ts

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `loadConfig`, `createMongo`, `ensureIndexes`, `closeMongo`, `buildApp({ config, db })`.
- Produces: the running server. Boot order: `loadConfig` → `createMongo` → `ensureIndexes(db)` → `buildApp({ config, db })` → `listen`. Shutdown closes the app then the mongo client. Any boot failure propagates to the top-level `catch` and exits non-zero.

There is no unit test for `server.ts` (it binds a socket and connects a real DB). Verification is a typecheck + full test suite + a build. This task is the integration point; its "test" is the whole suite going green and `tsc` compiling the real wiring.

- [ ] **Step 1: Rewrite `src/server.ts`**

```typescript
import { buildApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { closeMongo, createMongo } from "./lib/mongo.js";
import { ensureIndexes } from "./lib/indexes.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, db } = await createMongo(config);
  await ensureIndexes(db);

  const app = buildApp({ config, db });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await closeMongo(client);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    await closeMongo(client);
    process.exit(1);
  }
}

main().catch((err) => {
  // Config validation, mongo connect/index bootstrap, or unexpected startup failure.
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck the full project**

Run: `npm run typecheck`
Expected: PASS — `server.ts` now matches the new `buildApp` signature and all imports resolve.

- [ ] **Step 3: Run the full suite**

Run: `npm run test`
Expected: PASS — all config, mongo, indexes, app, and health tests green.

- [ ] **Step 4: Build to confirm the production bundle compiles**

Run: `npm run build`
Expected: PASS — `dist/` produced, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat(server): connect mongo, ensure indexes, and inject db at boot"
```

---

### Task 8: Full green gate and cleanup

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: a fully green `npm run check` and a clean build artifact.

- [ ] **Step 1: Run the full check gate**

Run: `npm run check`
Expected: PASS — lint, typecheck, and all tests green.

- [ ] **Step 2: Remove the build artifact if not tracked**

Run: `git status --porcelain`
Expected: clean (only intended files committed). If `dist/` appears and is not intended to be tracked, confirm it is git-ignored; the repo `.gitignore` should already cover it — do not commit `dist/`.

- [ ] **Step 3: Final commit only if needed**

If Step 1 required any lint/format fixes:

```bash
git add -A
git commit -m "chore: satisfy lint/format for mongodb setup"
```

Otherwise no commit is needed — the feature is complete.

---

## Self-Review

**1. Spec coverage:**
- Add `mongodb` dep → Task 1. ✓
- `MONGODB_URI`/`MONGODB_DB_NAME` config (required) + `.env.example` → Task 2. ✓
- `createMongo`/`ping`/`closeMongo` in `src/lib/mongo.ts` → Task 3. ✓
- `CORE_INDEXES` table + idempotent `ensureIndexes`, 8 collections, `org_project` tenancy index → Task 4. ✓
- `buildApp` injected `db` + decorate → Task 5. ✓
- `/ready` ping → 200/503 → Task 6. ✓
- Boot sequence connect → ensure → build → listen, shutdown closes client, fail-fast via top-level catch → Task 7. ✓
- Out-of-scope items (entity models, specialized/vector/text indexes, migrations) → not planned, correctly deferred. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"write tests for the above". All code and test bodies are concrete. ✓

**3. Type consistency:**
- `buildApp` signature `{ config, db }` used identically in Task 5 (def), Task 6 tests (via decorate helper), Task 7 (call site). ✓
- `ping(db)` signature consistent across Task 3 (def), Task 6 (`/ready`), Task 7 (indirect). ✓
- `ensureIndexes(db)` consistent Task 4 (def) / Task 7 (call). ✓
- `CORE_INDEXES` shape `{ collection, indexes: IndexSpec[] }` and `IndexSpec.name`/`.key` consistent between the module (Task 4 impl) and its test (Task 4 test). ✓
- Collection name set identical in `src/lib/indexes.ts` and `test/lib/indexes.test.ts` (8 names). ✓
- `app.db` decoration type (`Db`) declared once via `declare module "fastify"` in Task 5, consumed in Task 6. ✓

Note on task ordering: Task 5's signature change makes `server.ts` temporarily inconsistent until Task 7. Task 5 keeps its own scoped test green; the full `npm run typecheck`/`check` gate is asserted in Task 7 (Step 2) and Task 8. This is called out in Task 5's Interfaces note so an out-of-order executor is not surprised.
