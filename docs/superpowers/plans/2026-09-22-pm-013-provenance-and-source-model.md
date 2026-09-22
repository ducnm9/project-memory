# Provenance / Source Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-scoped, near-immutable `Source` entity with CRUD, and a thin `sourceIds` link on `KnowledgeItem` managed via attach/detach endpoints that append version snapshots.

**Architecture:** New `source-entities.ts` + `source-repository.ts` in the `knowledge-core` module follow the existing entity/store pattern (Zod schema + ULID id + org-scoped Mongo store, projection `{ _id: 0 }`). Source CRUD lives in a new `src/routes/sources.ts`; attach/detach lives in `src/routes/knowledge.ts` (it mutates a knowledge item and reuses the version store already wired there). A dedicated `setSourceIds` method on `KnowledgeItemStore` bumps `version` atomically via `$inc`, mirroring PM-012.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Fastify, MongoDB driver, Zod, `ulid`, Vitest. Tests use `test/support/fake-db.ts` (in-memory Mongo double) with Fastify `app.inject`.

**Spec:** `docs/superpowers/specs/2026-09-21-pm-013-provenance-and-source-model-design.md`

## Global Constraints

- All imports use `.js` specifiers (ESM), matching existing files.
- Every store method is scoped by `organizationId` as its first argument.
- Repository reads use `projection: { _id: 0 }` (fake-db mirrors this).
- IDs are `<prefix>_` + ULID; prefix for sources is `src_`. ID regex uses the Crockford alphabet `[0-9A-HJKMNP-TV-Z]{26}` (no I, L, O, U).
- Routes use `BEARER = { config: { auth: "bearer" as const } }` and the `context(req)` / `requireActor(req)` helpers.
- `nonEmpty = z.string().trim().min(1)` is a local const in each entities file.
- `projectIdSchema` is imported from `../project-context/entities.js` and applied in the route layer (never in the store).
- Commit after every task. Do not push.

---

### Task 1: `Source` entity + validation schema

**Files:**
- Create: `src/modules/knowledge-core/source-entities.ts`
- Test: `test/modules/knowledge-core/source-entities.test.ts`

**Interfaces:**
- Consumes: `ulid` from `ulid`, `z` from `zod`.
- Produces:
  - `SOURCE_TYPES: readonly SourceType[]` and `type SourceType`
  - `interface Source { id, organizationId, projectId, type, locator, metadata, createdBy, createdAt }`
  - `sourceIdSchema: ZodString` (regex `^src_[0-9A-HJKMNP-TV-Z]{26}$`)
  - `sourceTypeSchema: ZodEnum`
  - `createSourceBodySchema` (strict: `projectId`, `type`, `locator`, `metadata` default `{}`)
  - `newSourceId(): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/modules/knowledge-core/source-entities.test.ts
import { describe, expect, it } from "vitest";
import {
  createSourceBodySchema,
  newSourceId,
  sourceIdSchema,
  sourceTypeSchema,
} from "../../../src/modules/knowledge-core/source-entities.js";
import { newProjectId } from "../../../src/modules/project-context/entities.js";

describe("source-entities", () => {
  const projectId = newProjectId();

  it("newSourceId returns a src_-prefixed ULID that matches the id schema", () => {
    const id = newSourceId();
    expect(id).toMatch(/^src_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(sourceIdSchema.safeParse(id).success).toBe(true);
  });

  it("sourceIdSchema rejects a wrong prefix and wrong length", () => {
    expect(sourceIdSchema.safeParse("know_0000000000000000000000000").success).toBe(false);
    expect(sourceIdSchema.safeParse("src_short").success).toBe(false);
  });

  it("sourceTypeSchema accepts a known type and rejects an unknown one", () => {
    expect(sourceTypeSchema.safeParse("git_commit").success).toBe(true);
    expect(sourceTypeSchema.safeParse("carrier_pigeon").success).toBe(false);
  });

  it("createSourceBodySchema requires a non-empty locator", () => {
    const base = { projectId, type: "document", metadata: {} };
    expect(createSourceBodySchema.safeParse({ ...base, locator: "" }).success).toBe(false);
    expect(createSourceBodySchema.safeParse({ ...base, locator: "   " }).success).toBe(false);
    expect(createSourceBodySchema.safeParse({ ...base, locator: "https://x" }).success).toBe(true);
  });

  it("createSourceBodySchema defaults metadata to {} and rejects unknown fields", () => {
    const parsed = createSourceBodySchema.safeParse({
      projectId,
      type: "human_input",
      locator: "note from standup",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.metadata).toEqual({});

    const extra = createSourceBodySchema.safeParse({
      projectId,
      type: "human_input",
      locator: "x",
      surprise: 1,
    });
    expect(extra.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/source-entities.test.ts`
Expected: FAIL — cannot resolve `source-entities.js` / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/knowledge-core/source-entities.ts
import { ulid } from "ulid";
import { z } from "zod";

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
  id: string;
  organizationId: string;
  projectId: string;
  type: SourceType;
  locator: string;
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const sourceIdSchema = z.string().regex(/^src_[0-9A-HJKMNP-TV-Z]{26}$/);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);

const nonEmpty = z.string().trim().min(1);

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/source-entities.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/source-entities.ts test/modules/knowledge-core/source-entities.test.ts
git commit -m "feat(pm-013): Source entity and validation schema"
```

---

### Task 2: `SourceStore` repository

**Files:**
- Create: `src/modules/knowledge-core/source-repository.ts`
- Test: `test/modules/knowledge-core/source-repository.test.ts`

**Interfaces:**
- Consumes: `Db` from `mongodb`; `newSourceId`, `Source`, `SourceType` from `./source-entities.js`.
- Produces:
  - `interface CreateSourceInput { organizationId, projectId, type: SourceType, locator, metadata, createdBy }`
  - `interface SourceFilter { projectId?: string; type?: SourceType }`
  - `interface SourceStore { create, findById, findByProject, delete }` (no `update`)
  - `createSourceStore(db: Db): SourceStore`
  - `create(input) => Promise<Source>` (sets `id`, `createdAt`)
  - `findById(organizationId, id) => Promise<Source | null>`
  - `findByProject(organizationId, filter) => Promise<Source[]>`
  - `delete(organizationId, id) => Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
// test/modules/knowledge-core/source-repository.test.ts
import { describe, expect, it } from "vitest";
import { createSourceStore } from "../../../src/modules/knowledge-core/source-repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import { newProjectId } from "../../../src/modules/project-context/entities.js";

const orgA = "org_A";
const orgB = "org_B";
const projectId = newProjectId();

function store() {
  const { db, rows } = createFakeDb({ sources: [] });
  return { store: createSourceStore(db), rows };
}

const input = {
  organizationId: orgA,
  projectId,
  type: "git_commit" as const,
  locator: "abc123",
  metadata: { sha: "abc123" },
  createdBy: "tok_1",
};

describe("SourceStore", () => {
  it("create assigns an src_ id and createdAt, preserving fields", async () => {
    const { store: s } = store();
    const created = await s.create(input);
    expect(created.id).toMatch(/^src_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(created.createdAt).not.toBe("");
    expect(created.locator).toBe("abc123");
    expect(created.metadata).toEqual({ sha: "abc123" });
    expect(created.createdBy).toBe("tok_1");
  });

  it("findById is org-scoped", async () => {
    const { store: s } = store();
    const created = await s.create(input);
    expect(await s.findById(orgA, created.id)).not.toBeNull();
    expect(await s.findById(orgB, created.id)).toBeNull();
  });

  it("findByProject filters by projectId and type", async () => {
    const { store: s } = store();
    await s.create(input);
    await s.create({ ...input, type: "document", locator: "doc-1" });
    const byProject = await s.findByProject(orgA, { projectId });
    expect(byProject).toHaveLength(2);
    const byType = await s.findByProject(orgA, { projectId, type: "document" });
    expect(byType).toHaveLength(1);
    expect(byType[0].type).toBe("document");
  });

  it("delete returns true when removed and false when absent", async () => {
    const { store: s } = store();
    const created = await s.create(input);
    expect(await s.delete(orgA, created.id)).toBe(true);
    expect(await s.delete(orgA, created.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/source-repository.test.ts`
Expected: FAIL — cannot resolve `source-repository.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/knowledge-core/source-repository.ts
import type { Db } from "mongodb";
import { newSourceId, type Source, type SourceType } from "./source-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

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

export function createSourceStore(db: Db): SourceStore {
  const col = () => db.collection<Source>("sources");

  return {
    async create(input) {
      const source: Source = {
        id: newSourceId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        type: input.type,
        locator: input.locator,
        metadata: input.metadata,
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
      };
      await col().insertOne({ ...source });
      return source;
    },

    async findById(organizationId, id) {
      return col().findOne({ id, organizationId }, READ_OPTS) as Promise<Source | null>;
    },

    async findByProject(organizationId, filter) {
      const query: Record<string, unknown> = { organizationId };
      if (filter.projectId !== undefined) query.projectId = filter.projectId;
      if (filter.type !== undefined) query.type = filter.type;
      return col().find(query, READ_OPTS).toArray() as Promise<Source[]>;
    },

    async delete(organizationId, id) {
      const result = await col().deleteOne({ id, organizationId });
      return result.deletedCount > 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/source-repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/source-repository.ts test/modules/knowledge-core/source-repository.test.ts
git commit -m "feat(pm-013): SourceStore repository"
```

---

### Task 3: `SourceNotFoundError` + `sources` index

**Files:**
- Modify: `src/lib/errors.ts` (append a new error class after `KnowledgeNotFoundError`)
- Modify: `src/lib/indexes.ts` (add a `sources` entry to `CORE_COLLECTION_EXTRA_INDEXES`)
- Test: `test/lib/indexes.test.ts` (add one assertion block)

**Interfaces:**
- Consumes: `AppError` from `./errors.js` (already in the file); the existing `CORE_INDEXES` export.
- Produces: `class SourceNotFoundError extends AppError` (404, code `SOURCE_NOT_FOUND`); a `sources` entry in `CORE_INDEXES` with `id_unique` (unique) + `project_type`.

- [ ] **Step 1: Write the failing test**

Add this block to `test/lib/indexes.test.ts` (keep existing tests):

```ts
import { CORE_INDEXES } from "../../src/lib/indexes.js";
import { SourceNotFoundError } from "../../src/lib/errors.js";
import { describe, expect, it } from "vitest";

describe("sources indexes and error", () => {
  it("declares id_unique and project_type on the sources collection", () => {
    const sources = CORE_INDEXES.find((c) => c.collection === "sources");
    expect(sources).toBeDefined();
    const names = sources!.indexes.map((i) => i.name);
    expect(names).toContain("org_project"); // shared tenancy index
    expect(names).toContain("id_unique");
    expect(names).toContain("project_type");
    const idUnique = sources!.indexes.find((i) => i.name === "id_unique");
    expect(idUnique?.unique).toBe(true);
  });

  it("SourceNotFoundError is a 404 with code SOURCE_NOT_FOUND", () => {
    const err = new SourceNotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("SOURCE_NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/indexes.test.ts`
Expected: FAIL — `SourceNotFoundError` not exported; `sources` has no `id_unique`/`project_type`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/errors.ts`:

```ts
export class SourceNotFoundError extends AppError {
  constructor(message = "source not found") {
    super(message, 404, "SOURCE_NOT_FOUND");
  }
}
```

In `src/lib/indexes.ts`, add a `sources` key to `CORE_COLLECTION_EXTRA_INDEXES` (alongside `knowledge_items`):

```ts
  sources: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, type: 1 }, name: "project_type" },
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/indexes.test.ts`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts src/lib/indexes.ts test/lib/indexes.test.ts
git commit -m "feat(pm-013): SourceNotFoundError and sources indexes"
```

---

### Task 4: Source CRUD routes (`src/routes/sources.ts`)

**Files:**
- Create: `src/routes/sources.ts`
- Modify: `src/app.ts` (import + register `registerSourceRoutes`)
- Test: `test/routes/sources.test.ts`

**Interfaces:**
- Consumes: `createSourceStore` (Task 2), `createSourceBodySchema`/`sourceIdSchema`/`sourceTypeSchema` (Task 1), `SourceNotFoundError` (Task 3), `projectIdSchema` from project-context, `createRepository as createProjectContextRepository` from `../modules/project-context/repository.js`, `ProjectContext` type, existing errors.
- Produces: `registerSourceRoutes(app: FastifyInstance): void` handling `POST /sources`, `GET /sources/:id`, `GET /sources`, `DELETE /sources/:id`.

- [ ] **Step 1: Write the failing test**

```ts
// test/routes/sources.test.ts
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

const seeded = (extra: Collections = {}): Collections => ({
  projects: [project],
  sources: [],
  ...extra,
});

function buildApp(rows: Collections, withAuth = true): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    if (withAuth) enriched.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    enriched.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerSourceRoutes(app);
  return app;
}

async function createSource(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/sources",
    payload: { projectId, type: "git_commit", locator: "abc123", metadata: { sha: "abc123" }, ...overrides },
  });
}

describe("POST /sources", () => {
  it("creates a source and returns 201", async () => {
    const app = buildApp(seeded());
    const res = await createSource(app);
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; locator: string };
    expect(body.id).toMatch(/^src_/);
    expect(body.locator).toBe("abc123");
    await app.close();
  });

  it("returns 404 when the project does not exist", async () => {
    const app = buildApp(seeded());
    const res = await createSource(app, { projectId: newProjectId() });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for a bad type or empty locator", async () => {
    const app = buildApp(seeded());
    expect((await createSource(app, { type: "nope" })).statusCode).toBe(400);
    expect((await createSource(app, { locator: "" })).statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = buildApp(seeded(), false);
    expect((await createSource(app)).statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /sources/:id and list", () => {
  it("returns a created source and 404 for a missing one", async () => {
    const app = buildApp(seeded());
    const id = (await createSource(app)).json().id as string;
    expect((await app.inject({ method: "GET", url: `/sources/${id}` })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/sources/src_00000000000000000000000000" })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("returns 400 for a malformed id", async () => {
    const app = buildApp(seeded());
    expect((await app.inject({ method: "GET", url: "/sources/not-an-id" })).statusCode).toBe(400);
    await app.close();
  });

  it("lists sources filtered by type", async () => {
    const app = buildApp(seeded());
    await createSource(app);
    await createSource(app, { type: "document", locator: "doc-1" });
    const res = await app.inject({ method: "GET", url: `/sources?projectId=${projectId}&type=document` });
    expect(res.statusCode).toBe(200);
    const { sources } = res.json() as { sources: { type: string }[] };
    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe("document");
    await app.close();
  });
});

describe("DELETE /sources/:id", () => {
  it("deletes and returns 204, then 404 on the second delete", async () => {
    const app = buildApp(seeded());
    const id = (await createSource(app)).json().id as string;
    expect((await app.inject({ method: "DELETE", url: `/sources/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/sources/${id}` })).statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes/sources.test.ts`
Expected: FAIL — cannot resolve `sources.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/routes/sources.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import type { ProjectContext } from "../modules/project-context/context.js";
import {
  createSourceBodySchema,
  sourceIdSchema,
  sourceTypeSchema,
  type SourceType,
} from "../modules/knowledge-core/source-entities.js";
import { createSourceStore, type SourceFilter } from "../modules/knowledge-core/source-repository.js";
import {
  InvalidTenantScopeError,
  SourceNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  return ctx;
}

function requireActor(req: FastifyRequest): { actorId: string } {
  const actor = req.actor;
  if (!actor) throw new UnauthorizedError("missing credentials");
  return actor;
}

export function registerSourceRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createSourceStore(app.db);

  async function requireProject(organizationId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(organizationId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/sources", BEARER, async (req, reply) => {
    const actor = requireActor(req);
    const ctx = context(req);

    const parsed = createSourceBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError("invalid source body");
    const body = parsed.data;

    if (!projectIdSchema.safeParse(body.projectId).success) {
      throw new ValidationError("projectId is malformed");
    }
    await requireProject(ctx.organizationId, body.projectId);

    const source = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      type: body.type,
      locator: body.locator,
      metadata: body.metadata,
      createdBy: actor.actorId,
    });
    reply.status(201);
    return source;
  });

  app.get("/sources/:id", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    if (!sourceIdSchema.safeParse(id).success) throw new ValidationError("source id is malformed");

    const source = await store().findById(ctx.organizationId, id);
    if (!source) throw new SourceNotFoundError();
    return source;
  });

  app.get("/sources", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const query = req.query as { projectId?: string; type?: string };
    const filter: SourceFilter = {};

    if (query.projectId !== undefined) {
      if (!projectIdSchema.safeParse(query.projectId).success) {
        throw new ValidationError("projectId is malformed");
      }
      await requireProject(ctx.organizationId, query.projectId);
      filter.projectId = query.projectId;
    }
    if (query.type !== undefined) {
      const t = sourceTypeSchema.safeParse(query.type);
      if (!t.success) throw new ValidationError("type filter is invalid");
      filter.type = t.data as SourceType;
    }

    return { sources: await store().findByProject(ctx.organizationId, filter) };
  });

  app.delete("/sources/:id", BEARER, async (req, reply) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    if (!sourceIdSchema.safeParse(id).success) throw new ValidationError("source id is malformed");

    const removed = await store().delete(ctx.organizationId, id);
    if (!removed) throw new SourceNotFoundError();
    reply.status(204);
    return null;
  });
}
```

Register it in `src/app.ts`: add `import { registerSourceRoutes } from "./routes/sources.js";` with the other route imports, and call `registerSourceRoutes(app);` after `registerKnowledgeVersionRoutes(app);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/sources.ts src/app.ts test/routes/sources.test.ts
git commit -m "feat(pm-013): source CRUD routes"
```

---

### Task 5: `sourceIds` on `KnowledgeItem` + `setSourceIds` store method

**Files:**
- Modify: `src/modules/knowledge-core/entities.ts` (add `sourceIds: string[]` to the `KnowledgeItem` interface)
- Modify: `src/modules/knowledge-core/repository.ts` (init `sourceIds: []` in `create`; add `setSourceIds`)
- Test: `test/modules/knowledge-core/repository.test.ts` (add a `setSourceIds` block; if the file does not exist, create it)

**Interfaces:**
- Consumes: existing `KnowledgeItemStore`, `KnowledgeItem`.
- Produces: `KnowledgeItem.sourceIds: string[]`; new store method `setSourceIds(organizationId: string, id: string, sourceIds: string[]): Promise<KnowledgeItem | null>` that `$set`s `sourceIds` + `updatedAt` and `$inc`s `version` by 1.

- [ ] **Step 1: Write the failing test**

Create `test/modules/knowledge-core/repository.test.ts` (or add this `describe` if it already exists):

```ts
import { describe, expect, it } from "vitest";
import { createKnowledgeItemStore } from "../../../src/modules/knowledge-core/repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import { newProjectId } from "../../../src/modules/project-context/entities.js";

const orgA = "org_A";
const projectId = newProjectId();

function makeStore() {
  const { db } = createFakeDb({ knowledge_items: [] });
  return createKnowledgeItemStore(db);
}

const createInput = {
  organizationId: orgA,
  projectId,
  type: "Fact" as const,
  title: "t",
  summary: "s",
  content: { subject: "x", predicate: "is" },
  status: "DISCOVERED" as const,
  ownerId: "tok_1",
};

describe("KnowledgeItemStore.create initializes sourceIds", () => {
  it("new items start with an empty sourceIds array and version 1", async () => {
    const store = makeStore();
    const item = await store.create(createInput);
    expect(item.sourceIds).toEqual([]);
    expect(item.version).toBe(1);
  });
});

describe("KnowledgeItemStore.setSourceIds", () => {
  it("sets sourceIds and increments version", async () => {
    const store = makeStore();
    const item = await store.create(createInput);
    const updated = await store.setSourceIds(orgA, item.id, ["src_00000000000000000000000000"]);
    expect(updated).not.toBeNull();
    expect(updated!.sourceIds).toEqual(["src_00000000000000000000000000"]);
    expect(updated!.version).toBe(2);
  });

  it("returns null for an unknown item", async () => {
    const store = makeStore();
    expect(await store.setSourceIds(orgA, "know_00000000000000000000000000", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/repository.test.ts`
Expected: FAIL — `sourceIds` missing / `setSourceIds` not a function.

- [ ] **Step 3: Write minimal implementation**

In `src/modules/knowledge-core/entities.ts`, add to the `KnowledgeItem` interface (after `lastVerifiedAt`):

```ts
  sourceIds: string[];
```

In `src/modules/knowledge-core/repository.ts`:

1. In `create`, add `sourceIds: []` to the constructed `item` (after `lastVerifiedAt: null`).
2. Add `setSourceIds` to the `KnowledgeItemStore` interface:

```ts
  setSourceIds(
    organizationId: string,
    id: string,
    sourceIds: string[],
  ): Promise<KnowledgeItem | null>;
```

3. Implement it in the returned object (after `update`):

```ts
    async setSourceIds(organizationId, id, sourceIds) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { sourceIds, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as KnowledgeItem | null;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/entities.ts src/modules/knowledge-core/repository.ts test/modules/knowledge-core/repository.test.ts
git commit -m "feat(pm-013): sourceIds field and setSourceIds store method"
```

---

### Task 6: Attach / detach endpoints on knowledge items

**Files:**
- Modify: `src/routes/knowledge.ts` (add two routes; import the source store + `sourceIdSchema` + `SourceNotFoundError`)
- Test: `test/routes/knowledge-sources.test.ts`

**Interfaces:**
- Consumes: `createSourceStore` (Task 2), `sourceIdSchema` (Task 1), `SourceNotFoundError` (Task 3), `setSourceIds` (Task 5); the `store()`, `vStore()`, `context()`, `parseOrThrow` helpers already in `knowledge.ts`.
- Produces: `POST /knowledge/:id/sources` (body `{ sourceId }`) and `DELETE /knowledge/:id/sources/:sourceId`, each appending a version snapshot on change.

- [ ] **Step 1: Write the failing test**

```ts
// test/routes/knowledge-sources.test.ts
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerKnowledgeVersionRoutes } from "../../src/routes/knowledge-versions.js";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

const seeded = (): Collections => ({
  projects: [project],
  knowledge_items: [],
  knowledge_versions: [],
  sources: [],
});

function buildApp(rows: Collections): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    enriched.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    enriched.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerKnowledgeRoutes(app);
  registerKnowledgeVersionRoutes(app);
  registerSourceRoutes(app);
  return app;
}

async function seedItem(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/knowledge",
    payload: { projectId, type: "Fact", title: "t", summary: "s", content: { subject: "x", predicate: "is" } },
  });
  return (res.json() as { id: string }).id;
}

async function seedSource(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/sources",
    payload: { projectId, type: "git_commit", locator: "abc123" },
  });
  return (res.json() as { id: string }).id;
}

describe("POST /knowledge/:id/sources", () => {
  it("attaches a source, bumps version, and records a version snapshot", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const sourceId = await seedSource(app);
    const res = await app.inject({
      method: "POST",
      url: `/knowledge/${itemId}/sources`,
      payload: { sourceId },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json() as { sourceIds: string[]; version: number };
    expect(item.sourceIds).toEqual([sourceId]);
    expect(item.version).toBe(2);

    const versions = (
      await app.inject({ method: "GET", url: `/knowledge/${itemId}/versions` })
    ).json() as { versions: unknown[] };
    expect(versions.versions).toHaveLength(2);
    await app.close();
  });

  it("is idempotent when the source is already attached", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const sourceId = await seedSource(app);
    await app.inject({ method: "POST", url: `/knowledge/${itemId}/sources`, payload: { sourceId } });
    const second = await app.inject({
      method: "POST",
      url: `/knowledge/${itemId}/sources`,
      payload: { sourceId },
    });
    const item = second.json() as { sourceIds: string[]; version: number };
    expect(item.sourceIds).toEqual([sourceId]);
    expect(item.version).toBe(2); // unchanged
    const versions = (
      await app.inject({ method: "GET", url: `/knowledge/${itemId}/versions` })
    ).json() as { versions: unknown[] };
    expect(versions.versions).toHaveLength(2); // no new snapshot
    await app.close();
  });

  it("returns 404 for a non-existent source", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const res = await app.inject({
      method: "POST",
      url: `/knowledge/${itemId}/sources`,
      payload: { sourceId: "src_00000000000000000000000000" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 404 for a non-existent item", async () => {
    const app = buildApp(seeded());
    const sourceId = await seedSource(app);
    const res = await app.inject({
      method: "POST",
      url: `/knowledge/know_00000000000000000000000000/sources`,
      payload: { sourceId },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("DELETE /knowledge/:id/sources/:sourceId", () => {
  it("detaches a linked source and bumps version", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const sourceId = await seedSource(app);
    await app.inject({ method: "POST", url: `/knowledge/${itemId}/sources`, payload: { sourceId } });
    const res = await app.inject({ method: "DELETE", url: `/knowledge/${itemId}/sources/${sourceId}` });
    expect(res.statusCode).toBe(200);
    const item = res.json() as { sourceIds: string[]; version: number };
    expect(item.sourceIds).toEqual([]);
    expect(item.version).toBe(3);
    await app.close();
  });

  it("returns 404 when the link is absent", async () => {
    const app = buildApp(seeded());
    const itemId = await seedItem(app);
    const sourceId = await seedSource(app);
    const res = await app.inject({ method: "DELETE", url: `/knowledge/${itemId}/sources/${sourceId}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes/knowledge-sources.test.ts`
Expected: FAIL — routes not defined (404 on POST for a valid item, or route missing).

- [ ] **Step 3: Write minimal implementation**

In `src/routes/knowledge.ts`, add imports:

```ts
import { sourceIdSchema } from "../modules/knowledge-core/source-entities.js";
import { createSourceStore } from "../modules/knowledge-core/source-repository.js";
import { SourceNotFoundError } from "../lib/errors.js";
```

Add the source store accessor next to the others inside `registerKnowledgeRoutes`:

```ts
  const sourceStore = () => createSourceStore(app.db);
```

Add the two routes inside `registerKnowledgeRoutes` (after the `PATCH` route):

```ts
  app.post("/knowledge/:id/sources", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const body = (req.body ?? {}) as { sourceId?: unknown };
    parseOrThrow(sourceIdSchema, body.sourceId, "sourceId is malformed");
    const sourceId = body.sourceId as string;

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const source = await sourceStore().findById(ctx.organizationId, sourceId);
    if (!source) throw new SourceNotFoundError();

    const current = item.sourceIds ?? [];
    if (current.includes(sourceId)) return item; // idempotent: no bump, no snapshot

    const updated = await store().setSourceIds(ctx.organizationId, id, [...current, sourceId]);
    if (!updated) throw new KnowledgeNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      knowledgeId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `attached source ${sourceId}`,
    });
    return updated;
  });

  app.delete("/knowledge/:id/sources/:sourceId", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);
    const { id, sourceId } = req.params as { id: string; sourceId: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");
    parseOrThrow(sourceIdSchema, sourceId, "sourceId is malformed");

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const current = item.sourceIds ?? [];
    if (!current.includes(sourceId)) throw new SourceNotFoundError();

    const updated = await store().setSourceIds(
      ctx.organizationId,
      id,
      current.filter((s) => s !== sourceId),
    );
    if (!updated) throw new KnowledgeNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      knowledgeId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `detached source ${sourceId}`,
    });
    return updated;
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes/knowledge-sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/knowledge.ts test/routes/knowledge-sources.test.ts
git commit -m "feat(pm-013): attach/detach source endpoints on knowledge items"
```

---

### Task 7: Tenant isolation + backward-compat + full suite verification

**Files:**
- Test: `test/routes/sources-tenancy.test.ts`
- Test: `test/routes/knowledge-sources.test.ts` (add one backward-compat case)

**Interfaces:**
- Consumes: everything from Tasks 1–6. No new production code expected; if a test fails, the fix belongs to the relevant earlier task's file.

- [ ] **Step 1: Write the failing test**

```ts
// test/routes/sources-tenancy.test.ts
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgA = "org_A";
const orgB = "org_B";
const projectId = newProjectId();

function appForOrg(org: string, rows: Collections): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    enriched.actor = { actorId: "tok", organizationId: org, type: "service" };
    enriched.projectContext = { organizationId: org, projectId: null };
  });
  registerErrorHandler(app);
  registerSourceRoutes(app);
  return app;
}

describe("source tenant isolation", () => {
  it("org B cannot read or delete org A's source", async () => {
    // Shared row store so both apps see the same collections.
    const rows: Collections = {
      projects: [{ id: projectId, organizationId: orgA, name: "p", createdAt: "", updatedAt: "" }],
      sources: [],
    };
    const appA = appForOrg(orgA, rows);
    const created = await appA.inject({
      method: "POST",
      url: "/sources",
      payload: { projectId, type: "document", locator: "doc-1" },
    });
    const id = (created.json() as { id: string }).id;
    await appA.close();

    const appB = appForOrg(orgB, rows);
    expect((await appB.inject({ method: "GET", url: `/sources/${id}` })).statusCode).toBe(404);
    expect((await appB.inject({ method: "DELETE", url: `/sources/${id}` })).statusCode).toBe(404);
    await appB.close();
  });
});
```

Add this backward-compat case inside the existing
`describe("POST /knowledge/:id/sources", ...)` block in
`test/routes/knowledge-sources.test.ts`:

```ts
  it("attaches to a pre-PM-013 item that has no sourceIds field", async () => {
    const rows = seeded();
    // Simulate a legacy item written before the sourceIds field existed.
    (rows.knowledge_items as unknown[]).push({
      id: "know_00000000000000000000000000",
      organizationId: orgId,
      projectId,
      type: "Fact",
      title: "legacy",
      summary: "s",
      content: {},
      status: "DISCOVERED",
      version: 1,
      ownerId: "tok_1",
      createdAt: "",
      updatedAt: "",
      lastVerifiedAt: null,
      // no sourceIds
    });
    const app = buildApp(rows);
    const sourceId = await seedSource(app);
    const res = await app.inject({
      method: "POST",
      url: `/knowledge/know_00000000000000000000000000/sources`,
      payload: { sourceId },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { sourceIds: string[] }).sourceIds).toEqual([sourceId]);
    await app.close();
  });
```

- [ ] **Step 2: Run test to verify it fails (or passes)**

Run: `npx vitest run test/routes/sources-tenancy.test.ts test/routes/knowledge-sources.test.ts`
Expected: the two new cases exercise isolation and legacy read. If the backward-compat case fails, the fix is a missing `item.sourceIds ?? []` guard in Task 6's attach route — apply it there.

- [ ] **Step 3: Fix if needed**

If the tenant-isolation test fails, confirm every source store query includes `organizationId` (Task 2). If the backward-compat test fails, ensure the attach route reads `const current = item.sourceIds ?? [];` (Task 6). No new files.

- [ ] **Step 4: Run the full suite + typecheck + lint**

Run: `npm test`
Expected: all suites PASS.

Run: `npm run typecheck`
Expected: no type errors.

Run: `npm run lint`
Expected: no lint errors.

- [ ] **Step 5: Commit**

```bash
git add test/routes/sources-tenancy.test.ts test/routes/knowledge-sources.test.ts
git commit -m "test(pm-013): source tenant isolation and backward-compat"
```

---

## Notes for the executor

- Do not add a `PATCH /sources/:id` or any source mutation — sources are near-immutable by design.
- Deleting a source does **not** clean up `sourceIds` on items; a now-dangling id is expected and accepted. Do not add cascade logic.
- `metadata` is intentionally an unvalidated open blob. Do not add per-type schemas.
- The `npm test` / `npm run lint` scripts are defined in `package.json`; if a command name differs, check `package.json` scripts before improvising. `npm run check` runs lint + typecheck + test together.
