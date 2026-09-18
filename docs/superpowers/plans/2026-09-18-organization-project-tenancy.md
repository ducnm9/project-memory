# Organization / Project Multi-Tenancy (PM-003) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add enforced organization/project tenancy: the Organization and Project entities, request-scoped context resolution from headers, and a data-layer helper that makes cross-tenant access structurally impossible.

**Architecture:** Two new root collections (`organizations`, `projects`) with a repository, a header-driven `resolveContext` validator, a Fastify plugin that decorates `request.projectContext`, management routes, and a transport-agnostic `scopedCollection` helper that injects the tenant filter on reads and stamps exact scope on writes. Auth is out of scope (PM-004).

**Tech Stack:** TypeScript (ESM, Node ≥20.19), Fastify 5, MongoDB driver 7, Zod 3, Vitest 2, `ulid` (new). All imports use `.js` extensions.

**Spec:** `docs/superpowers/specs/2026-09-18-organization-project-tenancy-design.md`

## Global Constraints

- **Module system:** ESM. Every relative import ends in `.js` (e.g. `import { x } from "../lib/errors.js"`).
- **Dependency versions:** pin exact (no `^`/`~`). Add `ulid` at `2.3.0`.
- **Error shape (codebase actual):** all errors surface as `{ error: { code, message } }` via `AppError` subclasses in `src/lib/errors.ts`. Codes are `SCREAMING_SNAKE_CASE`. (This supersedes the spec's illustrative flat `{ error, message }` / lowercase-code drafts — the real codebase shape wins. New codes: `INVALID_TENANT_SCOPE`, `TENANT_NOT_FOUND`.)
- **Tests live in a parallel tree:** `test/**` mirroring `src/**` (vitest `include: ["test/**/*.test.ts"]`). Not co-located. (Supersedes the spec's "co-located tests" wording.)
- **DB in unit tests is mocked** via `{ collection: vi.fn().mockReturnValue({ ... }) } as unknown as Db`. No live Mongo.
- **Routes are registered** by exported `registerXRoutes(app)` / `registerXPlugin(app)` functions called from `src/app.ts`.
- **Non-leaking 404:** org-missing, project-missing, and project-belongs-to-another-org all return the identical `TENANT_NOT_FOUND` body `"organization or project not found"`.
- **Verify each task** with `npm run check` (lint + typecheck + test) before commit where practical; individual test runs are shown per task.

---

### Task 1: Tenant error types

**Files:**
- Modify: `src/lib/errors.ts`
- Test: `test/lib/errors.test.ts`

**Interfaces:**
- Consumes: `AppError` (existing, `constructor(message, statusCode, code)`).
- Produces: `class InvalidTenantScopeError extends AppError` (400, code `INVALID_TENANT_SCOPE`); `class TenantNotFoundError extends AppError` (404, code `TENANT_NOT_FOUND`, fixed message `"organization or project not found"`).

- [ ] **Step 1: Write the failing test**

Append to `test/lib/errors.test.ts`:

```typescript
import { InvalidTenantScopeError, TenantNotFoundError } from "../../src/lib/errors.js";

describe("tenant errors", () => {
  it("InvalidTenantScopeError is a 400 with INVALID_TENANT_SCOPE", () => {
    const e = new InvalidTenantScopeError("x-organization-id is required");
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe("INVALID_TENANT_SCOPE");
    expect(e.message).toBe("x-organization-id is required");
  });

  it("TenantNotFoundError is a 404 with a fixed non-leaking message", () => {
    const e = new TenantNotFoundError();
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("TENANT_NOT_FOUND");
    expect(e.message).toBe("organization or project not found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/errors.test.ts`
Expected: FAIL — `InvalidTenantScopeError`/`TenantNotFoundError` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/errors.ts`:

```typescript
export class InvalidTenantScopeError extends AppError {
  constructor(message: string) {
    super(message, 400, "INVALID_TENANT_SCOPE");
  }
}

export class TenantNotFoundError extends AppError {
  constructor() {
    super("organization or project not found", 404, "TENANT_NOT_FOUND");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts test/lib/errors.test.ts
git commit -m "feat(PM-003): tenant error types"
```

---

### Task 2: Entities and Zod schemas

**Files:**
- Create: `src/modules/project-context/entities.ts`
- Test: `test/modules/project-context/entities.test.ts`

**Interfaces:**
- Consumes: `ulid` package.
- Produces:
  - `interface Organization { id: string; name: string; createdAt: string; updatedAt: string }`
  - `interface Project { id: string; organizationId: string; name: string; createdAt: string; updatedAt: string }`
  - `const orgIdSchema: ZodString` (matches `/^org_[0-9A-HJKMNP-TV-Z]{26}$/`)
  - `const projectIdSchema: ZodString` (matches `/^proj_[0-9A-HJKMNP-TV-Z]{26}$/`)
  - `const createOrgBodySchema` → `{ name: string }` (trimmed, min 1)
  - `const createProjectBodySchema` → `{ name: string }` (trimmed, min 1)
  - `function newOrgId(): string` (returns `` `org_${ulid()}` ``)
  - `function newProjectId(): string` (returns `` `proj_${ulid()}` ``)

- [ ] **Step 1: Add the `ulid` dependency**

Run: `npm install --save-exact ulid@2.3.0`
Expected: `package.json` dependencies now include `"ulid": "2.3.0"`.

- [ ] **Step 2: Write the failing test**

Create `test/modules/project-context/entities.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  createOrgBodySchema,
  createProjectBodySchema,
  newOrgId,
  newProjectId,
  orgIdSchema,
  projectIdSchema,
} from "../../../src/modules/project-context/entities.js";

describe("id generators", () => {
  it("newOrgId is a valid org id", () => {
    expect(orgIdSchema.safeParse(newOrgId()).success).toBe(true);
  });
  it("newProjectId is a valid project id", () => {
    expect(projectIdSchema.safeParse(newProjectId()).success).toBe(true);
  });
  it("orgIdSchema rejects a project id", () => {
    expect(orgIdSchema.safeParse(newProjectId()).success).toBe(false);
  });
});

describe("body schemas", () => {
  it("trims and accepts a non-empty name", () => {
    expect(createOrgBodySchema.parse({ name: "  Acme  " })).toEqual({ name: "Acme" });
    expect(createProjectBodySchema.parse({ name: "svc" })).toEqual({ name: "svc" });
  });
  it("rejects an empty or whitespace name", () => {
    expect(createOrgBodySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createOrgBodySchema.safeParse({}).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/modules/project-context/entities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

Create `src/modules/project-context/entities.ts`:

```typescript
import { ulid } from "ulid";
import { z } from "zod";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const orgIdSchema = z.string().regex(/^org_[0-9A-HJKMNP-TV-Z]{26}$/);
export const projectIdSchema = z.string().regex(/^proj_[0-9A-HJKMNP-TV-Z]{26}$/);

const nameSchema = z.string().trim().min(1);
export const createOrgBodySchema = z.object({ name: nameSchema });
export const createProjectBodySchema = z.object({ name: nameSchema });

export function newOrgId(): string {
  return `org_${ulid()}`;
}

export function newProjectId(): string {
  return `proj_${ulid()}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/modules/project-context/entities.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/modules/project-context/entities.ts test/modules/project-context/entities.test.ts
git commit -m "feat(PM-003): org/project entities and schemas"
```

---

### Task 3: Repository (orgs/projects persistence)

**Files:**
- Create: `src/modules/project-context/repository.ts`
- Test: `test/modules/project-context/repository.test.ts`

**Interfaces:**
- Consumes: `Db` from `mongodb`; `Organization`, `Project`, `newOrgId`, `newProjectId` from `entities.js`.
- Produces a `ProjectContextRepository` created by `createRepository(db: Db)` with:
  - `createOrganization(name: string): Promise<Organization>`
  - `getOrganization(id: string): Promise<Organization | null>`
  - `listOrganizations(): Promise<Organization[]>`
  - `createProject(organizationId: string, name: string): Promise<Project>`
  - `getProject(organizationId: string, id: string): Promise<Project | null>` — returns null if the project's `organizationId` does not match (org-ownership check)
  - `listProjects(organizationId: string): Promise<Project[]>`

  Collections used: `organizations`, `projects`. Documents are stored without Mongo's `_id` projection leaking out — use `{ projection: { _id: 0 } }` on reads.

- [ ] **Step 1: Write the failing test**

Create `test/modules/project-context/repository.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createRepository } from "../../../src/modules/project-context/repository.js";

function mockDb(handlers: Record<string, unknown>) {
  const collection = vi.fn((name: string) => handlers[name]);
  return { db: { collection } as unknown as Db, collection };
}

describe("createOrganization", () => {
  it("inserts and returns an org with a generated id and timestamps", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const { db } = mockDb({ organizations: { insertOne } });
    const repo = createRepository(db);
    const org = await repo.createOrganization("Acme");
    expect(org.name).toBe("Acme");
    expect(org.id).toMatch(/^org_/);
    expect(org.createdAt).toBe(org.updatedAt);
    expect(insertOne).toHaveBeenCalledWith(expect.objectContaining({ id: org.id, name: "Acme" }));
  });
});

describe("getProject org-ownership", () => {
  it("returns null when the project belongs to a different org", async () => {
    const findOne = vi.fn().mockResolvedValue(null); // filter includes organizationId, so mismatch = no doc
    const { db } = mockDb({ projects: { findOne } });
    const repo = createRepository(db);
    const result = await repo.getProject("org_A", "proj_X");
    expect(result).toBeNull();
    expect(findOne).toHaveBeenCalledWith(
      { id: "proj_X", organizationId: "org_A" },
      { projection: { _id: 0 } },
    );
  });
});

describe("listProjects", () => {
  it("queries by organizationId and returns the array", async () => {
    const toArray = vi.fn().mockResolvedValue([{ id: "proj_1", organizationId: "org_A", name: "p" }]);
    const find = vi.fn().mockReturnValue({ toArray });
    const { db } = mockDb({ projects: { find } });
    const repo = createRepository(db);
    const rows = await repo.listProjects("org_A");
    expect(find).toHaveBeenCalledWith({ organizationId: "org_A" }, { projection: { _id: 0 } });
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/project-context/repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/project-context/repository.ts`:

```typescript
import type { Db } from "mongodb";
import {
  newOrgId,
  newProjectId,
  type Organization,
  type Project,
} from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface ProjectContextRepository {
  createOrganization(name: string): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | null>;
  listOrganizations(): Promise<Organization[]>;
  createProject(organizationId: string, name: string): Promise<Project>;
  getProject(organizationId: string, id: string): Promise<Project | null>;
  listProjects(organizationId: string): Promise<Project[]>;
}

export function createRepository(db: Db): ProjectContextRepository {
  const orgs = () => db.collection<Organization>("organizations");
  const projects = () => db.collection<Project>("projects");

  return {
    async createOrganization(name) {
      const now = new Date().toISOString();
      const org: Organization = { id: newOrgId(), name, createdAt: now, updatedAt: now };
      await orgs().insertOne(org);
      return org;
    },
    async getOrganization(id) {
      return orgs().findOne({ id }, READ_OPTS) as Promise<Organization | null>;
    },
    async listOrganizations() {
      return orgs().find({}, READ_OPTS).toArray() as Promise<Organization[]>;
    },
    async createProject(organizationId, name) {
      const now = new Date().toISOString();
      const project: Project = {
        id: newProjectId(),
        organizationId,
        name,
        createdAt: now,
        updatedAt: now,
      };
      await projects().insertOne(project);
      return project;
    },
    async getProject(organizationId, id) {
      return projects().findOne({ id, organizationId }, READ_OPTS) as Promise<Project | null>;
    },
    async listProjects(organizationId) {
      return projects().find({ organizationId }, READ_OPTS).toArray() as Promise<Project[]>;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/project-context/repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/project-context/repository.ts test/modules/project-context/repository.test.ts
git commit -m "feat(PM-003): org/project repository with org-ownership check"
```

---

### Task 4: Context resolution from headers

**Files:**
- Create: `src/modules/project-context/context.ts`
- Test: `test/modules/project-context/context.test.ts`

**Interfaces:**
- Consumes: `ProjectContextRepository` (Task 3); `orgIdSchema`, `projectIdSchema` (Task 2); `InvalidTenantScopeError`, `TenantNotFoundError` (Task 1).
- Produces:
  - `interface ProjectContext { organizationId: string; projectId: string | null }`
  - `interface ScopeHeaders { organizationId?: string; projectId?: string }`
  - `async function resolveContext(repo: ProjectContextRepository, headers: ScopeHeaders): Promise<ProjectContext>` — throws `InvalidTenantScopeError` on missing/malformed org id or malformed project id; throws `TenantNotFoundError` when the org does not exist, or the project does not exist / belongs to another org; returns `{ organizationId, projectId: null }` when no project header is present.

- [ ] **Step 1: Write the failing test**

Create `test/modules/project-context/context.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveContext } from "../../../src/modules/project-context/context.js";
import type { ProjectContextRepository } from "../../../src/modules/project-context/repository.js";
import {
  InvalidTenantScopeError,
  TenantNotFoundError,
} from "../../../src/lib/errors.js";
import { newOrgId, newProjectId } from "../../../src/modules/project-context/entities.js";

function repoStub(over: Partial<ProjectContextRepository> = {}): ProjectContextRepository {
  return {
    createOrganization: async () => { throw new Error("unused"); },
    getOrganization: async () => null,
    listOrganizations: async () => [],
    createProject: async () => { throw new Error("unused"); },
    getProject: async () => null,
    listProjects: async () => [],
    ...over,
  };
}

const orgId = newOrgId();
const projId = newProjectId();

describe("resolveContext", () => {
  it("throws InvalidTenantScopeError when org header is missing", async () => {
    await expect(resolveContext(repoStub(), {})).rejects.toBeInstanceOf(InvalidTenantScopeError);
  });

  it("throws InvalidTenantScopeError when org id is malformed", async () => {
    await expect(resolveContext(repoStub(), { organizationId: "bad" })).rejects.toBeInstanceOf(
      InvalidTenantScopeError,
    );
  });

  it("throws TenantNotFoundError when the org does not exist", async () => {
    const repo = repoStub({ getOrganization: async () => null });
    await expect(resolveContext(repo, { organizationId: orgId })).rejects.toBeInstanceOf(
      TenantNotFoundError,
    );
  });

  it("returns org-shared scope (projectId null) when no project header", async () => {
    const repo = repoStub({ getOrganization: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) });
    await expect(resolveContext(repo, { organizationId: orgId })).resolves.toEqual({
      organizationId: orgId,
      projectId: null,
    });
  });

  it("throws TenantNotFoundError when the project is absent or foreign", async () => {
    const repo = repoStub({
      getOrganization: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }),
      getProject: async () => null,
    });
    await expect(
      resolveContext(repo, { organizationId: orgId, projectId: projId }),
    ).rejects.toBeInstanceOf(TenantNotFoundError);
  });

  it("resolves full project scope when both exist and match", async () => {
    const repo = repoStub({
      getOrganization: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }),
      getProject: async () => ({ id: projId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }),
    });
    await expect(
      resolveContext(repo, { organizationId: orgId, projectId: projId }),
    ).resolves.toEqual({ organizationId: orgId, projectId: projId });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/project-context/context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/project-context/context.ts`:

```typescript
import { InvalidTenantScopeError, TenantNotFoundError } from "../../lib/errors.js";
import { orgIdSchema, projectIdSchema } from "./entities.js";
import type { ProjectContextRepository } from "./repository.js";

export interface ProjectContext {
  organizationId: string;
  projectId: string | null;
}

export interface ScopeHeaders {
  organizationId?: string;
  projectId?: string;
}

export async function resolveContext(
  repo: ProjectContextRepository,
  headers: ScopeHeaders,
): Promise<ProjectContext> {
  const orgParse = orgIdSchema.safeParse(headers.organizationId);
  if (!orgParse.success) {
    throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  }
  const organizationId = orgParse.data;

  if (!(await repo.getOrganization(organizationId))) {
    throw new TenantNotFoundError();
  }

  if (headers.projectId === undefined) {
    return { organizationId, projectId: null };
  }

  const projParse = projectIdSchema.safeParse(headers.projectId);
  if (!projParse.success) {
    throw new InvalidTenantScopeError("x-project-id is malformed");
  }
  const projectId = projParse.data;

  if (!(await repo.getProject(organizationId, projectId))) {
    throw new TenantNotFoundError();
  }

  return { organizationId, projectId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/project-context/context.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/project-context/context.ts test/modules/project-context/context.test.ts
git commit -m "feat(PM-003): resolve project context from headers"
```

---

### Task 5: scopedCollection enforcement helper

**Files:**
- Create: `src/lib/scoped-collection.ts`
- Test: `test/lib/scoped-collection.test.ts`

**Interfaces:**
- Consumes: `Db` from `mongodb`; `ProjectContext` from `../modules/project-context/context.js`.
- Produces: `function scopedCollection<T>(db: Db, name: string, ctx: ProjectContext): ScopedCollection<T>` with:
  - `find(filter?): FindCursor` — merges `{ organizationId, projectId: { $in: [ctx.projectId, null] } }` into the caller filter. When `ctx.projectId` is `null`, `$in` deduplicates to `[null]` (org-shared only) — intended.
  - `findOne(filter?): Promise<T | null>` — same tenant predicate merged in.
  - `insertOne(doc): Promise<...>` — stamps `{ organizationId: ctx.organizationId, projectId: ctx.projectId }` onto the doc (overriding any caller-supplied scope).

  The tenant predicate is always applied by the helper; callers cannot remove it or write to a different scope.

- [ ] **Step 1: Write the failing test**

Create `test/lib/scoped-collection.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { scopedCollection } from "../../src/lib/scoped-collection.js";

function mockCollection() {
  const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
  const findOne = vi.fn().mockResolvedValue(null);
  const insertOne = vi.fn().mockResolvedValue({});
  const db = { collection: vi.fn().mockReturnValue({ find, findOne, insertOne }) } as unknown as Db;
  return { db, find, findOne, insertOne };
}

const projectCtx = { organizationId: "org_A", projectId: "proj_1" };
const sharedCtx = { organizationId: "org_A", projectId: null };

describe("scopedCollection reads", () => {
  it("injects org + project|null predicate on find", () => {
    const { db, find } = mockCollection();
    scopedCollection(db, "knowledge_items", projectCtx).find({ type: "Decision" });
    expect(find).toHaveBeenCalledWith({
      type: "Decision",
      organizationId: "org_A",
      projectId: { $in: ["proj_1", null] },
    });
  });

  it("at org-shared scope the predicate is projectId null only", () => {
    const { db, find } = mockCollection();
    scopedCollection(db, "knowledge_items", sharedCtx).find();
    expect(find).toHaveBeenCalledWith({
      organizationId: "org_A",
      projectId: { $in: [null] },
    });
  });
});

describe("scopedCollection writes", () => {
  it("stamps the exact scope, overriding any caller-supplied scope", async () => {
    const { db, insertOne } = mockCollection();
    await scopedCollection(db, "knowledge_items", projectCtx).insertOne({
      title: "x",
      organizationId: "org_EVIL",
      projectId: "proj_EVIL",
    });
    expect(insertOne).toHaveBeenCalledWith({
      title: "x",
      organizationId: "org_A",
      projectId: "proj_1",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/scoped-collection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/scoped-collection.ts`:

```typescript
import type { Db, Document, Filter, FindCursor, WithId } from "mongodb";
import type { ProjectContext } from "../modules/project-context/context.js";

export interface ScopedCollection<T extends Document> {
  find(filter?: Filter<T>): FindCursor<WithId<T>>;
  findOne(filter?: Filter<T>): Promise<WithId<T> | null>;
  insertOne(doc: T): Promise<unknown>;
}

export function scopedCollection<T extends Document>(
  db: Db,
  name: string,
  ctx: ProjectContext,
): ScopedCollection<T> {
  const col = db.collection<T>(name);
  // Deduplicate so org-shared scope (projectId null) yields { $in: [null] }.
  const projectValues = Array.from(new Set([ctx.projectId, null]));
  const tenant = { organizationId: ctx.organizationId, projectId: { $in: projectValues } };

  const withTenant = (filter?: Filter<T>): Filter<T> =>
    ({ ...(filter ?? {}), ...tenant }) as Filter<T>;

  return {
    find: (filter) => col.find(withTenant(filter)),
    findOne: (filter) => col.findOne(withTenant(filter)),
    insertOne: (doc) =>
      col.insertOne({
        ...doc,
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
      } as unknown as Parameters<typeof col.insertOne>[0]),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/scoped-collection.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoped-collection.ts test/lib/scoped-collection.test.ts
git commit -m "feat(PM-003): scopedCollection tenant enforcement helper"
```

---

### Task 6: tenant-context Fastify plugin

**Files:**
- Create: `src/plugins/tenant-context.ts`
- Test: `test/plugins/tenant-context.test.ts`

**Interfaces:**
- Consumes: `resolveContext`, `ProjectContext`, `ScopeHeaders` (Task 4); `createRepository` (Task 3); `Db`; existing `AppError` handling in `error-handler`.
- Produces:
  - Module augmentation adding `projectContext?: ProjectContext` to `FastifyRequest`.
  - `function registerTenantContext(app: FastifyInstance): void` registering an `onRequest` hook that reads `x-organization-id` / `x-project-id`, calls `resolveContext(createRepository(app.db), headers)`, and assigns `request.projectContext`. Thrown `AppError`s propagate to the existing error handler (400/404). The hook skips routes that opt out (see note), but by default applies to all routes.
  - The hook only runs for requests that carry an `x-organization-id` header OR are under a scoped route prefix. To keep Task 6 self-contained and testable, the hook resolves whenever `x-organization-id` is present, and is a no-op when absent (management routes in Task 7 take ids from the path, not headers, so they must not require the header). This means: header present → resolve (may 400/404); header absent → `request.projectContext` stays undefined.

- [ ] **Step 1: Write the failing test**

Create `test/plugins/tenant-context.test.ts`:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { registerTenantContext } from "../../src/plugins/tenant-context.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerErrorHandler(app);
  registerTenantContext(app);
  app.get("/probe", async (req) => ({ ctx: req.projectContext ?? null }));
  return app;
}

// org exists, no projects
const dbOrgOnly = () =>
  ({
    collection: (name: string) =>
      name === "organizations"
        ? { findOne: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) }
        : { findOne: async () => null },
  }) as unknown as Db;

describe("tenant-context plugin", () => {
  it("attaches org-shared context when only org header is present", async () => {
    const app = buildApp(dbOrgOnly());
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ctx: { organizationId: orgId, projectId: null } });
    await app.close();
  });

  it("is a no-op (no context) when no org header is present", async () => {
    const app = buildApp(dbOrgOnly());
    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ctx: null });
    await app.close();
  });

  it("returns 400 for a malformed org header", async () => {
    const app = buildApp(dbOrgOnly());
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": "bad" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TENANT_SCOPE");
    await app.close();
  });

  it("returns a non-leaking 404 for an unknown org", async () => {
    const missing = () =>
      ({ collection: () => ({ findOne: async () => null }) }) as unknown as Db;
    const app = buildApp(missing());
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "TENANT_NOT_FOUND", message: "organization or project not found" } });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugins/tenant-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/plugins/tenant-context.ts`:

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository } from "../modules/project-context/repository.js";
import { resolveContext, type ProjectContext } from "../modules/project-context/context.js";

declare module "fastify" {
  interface FastifyRequest {
    projectContext?: ProjectContext;
  }
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function registerTenantContext(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    const organizationId = header(req, "x-organization-id");
    if (organizationId === undefined) return; // no-op; path-scoped routes handle their own ids
    const repo = createRepository(app.db);
    req.projectContext = await resolveContext(repo, {
      organizationId,
      projectId: header(req, "x-project-id"),
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugins/tenant-context.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/tenant-context.ts test/plugins/tenant-context.test.ts
git commit -m "feat(PM-003): tenant-context plugin"
```

---

### Task 7: Organization / project management routes

**Files:**
- Create: `src/routes/organizations.ts`
- Test: `test/routes/organizations.test.ts`

**Interfaces:**
- Consumes: `createRepository` (Task 3); `createOrgBodySchema`, `createProjectBodySchema`, `orgIdSchema`, `projectIdSchema` (Task 2); `InvalidTenantScopeError`, `TenantNotFoundError` (Task 1); `Db` on `app`.
- Produces: `function registerOrganizationRoutes(app: FastifyInstance): void` wiring the six endpoints from the spec. Body/path validation uses the Zod schemas; failures throw `InvalidTenantScopeError` (400); missing org/project throws `TenantNotFoundError` (404). These routes take ids from the **path**, not tenant headers.

- [ ] **Step 1: Write the failing test**

Create `test/routes/organizations.test.ts`:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { registerOrganizationRoutes } from "../../src/routes/organizations.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function buildApp(handlers: Record<string, Record<string, unknown>>): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = { collection: (n: string) => handlers[n] } as unknown as Db;
  app.decorate("db", db);
  registerErrorHandler(app);
  registerOrganizationRoutes(app);
  return app;
}

describe("POST /organizations", () => {
  it("creates and returns 201 with a generated id", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const app = buildApp({ organizations: { insertOne } });
    const res = await app.inject({ method: "POST", url: "/organizations", payload: { name: "Acme" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^org_/);
    expect(res.json().name).toBe("Acme");
    await app.close();
  });

  it("rejects an empty name with 400", async () => {
    const app = buildApp({ organizations: { insertOne: vi.fn() } });
    const res = await app.inject({ method: "POST", url: "/organizations", payload: { name: " " } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TENANT_SCOPE");
    await app.close();
  });
});

describe("GET /organizations/:orgId", () => {
  it("returns 404 (non-leaking) for an unknown org", async () => {
    const app = buildApp({ organizations: { findOne: vi.fn().mockResolvedValue(null) } });
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "TENANT_NOT_FOUND", message: "organization or project not found" } });
    await app.close();
  });

  it("returns 400 for a malformed org id in the path", async () => {
    const app = buildApp({ organizations: { findOne: vi.fn() } });
    const res = await app.inject({ method: "GET", url: "/organizations/bad" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /organizations/:orgId/projects", () => {
  it("returns 404 when the parent org is missing", async () => {
    const app = buildApp({
      organizations: { findOne: vi.fn().mockResolvedValue(null) },
      projects: { insertOne: vi.fn() },
    });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/projects`, payload: { name: "p" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("creates a project (201) under an existing org", async () => {
    const app = buildApp({
      organizations: { findOne: vi.fn().mockResolvedValue({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) },
      projects: { insertOne: vi.fn().mockResolvedValue({}) },
    });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/projects`, payload: { name: "p" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^proj_/);
    expect(res.json().organizationId).toBe(orgId);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes/organizations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/routes/organizations.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { createRepository } from "../modules/project-context/repository.js";
import {
  createOrgBodySchema,
  createProjectBodySchema,
  orgIdSchema,
  projectIdSchema,
} from "../modules/project-context/entities.js";
import { InvalidTenantScopeError, TenantNotFoundError } from "../lib/errors.js";

function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, value: unknown, msg: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new InvalidTenantScopeError(msg);
  return r.data as T;
}

export function registerOrganizationRoutes(app: FastifyInstance): void {
  const repo = () => createRepository(app.db);

  app.post("/organizations", async (req, reply) => {
    const { name } = parseOrThrow(createOrgBodySchema, req.body, "name is required");
    reply.status(201);
    return repo().createOrganization(name);
  });

  app.get("/organizations", async () => ({ organizations: await repo().listOrganizations() }));

  app.get("/organizations/:orgId", async (req) => {
    const { orgId } = req.params as { orgId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    const org = await repo().getOrganization(orgId);
    if (!org) throw new TenantNotFoundError();
    return org;
  });

  app.post("/organizations/:orgId/projects", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    const { name } = parseOrThrow(createProjectBodySchema, req.body, "name is required");
    if (!(await repo().getOrganization(orgId))) throw new TenantNotFoundError();
    reply.status(201);
    return repo().createProject(orgId, name);
  });

  app.get("/organizations/:orgId/projects", async (req) => {
    const { orgId } = req.params as { orgId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    if (!(await repo().getOrganization(orgId))) throw new TenantNotFoundError();
    return { projects: await repo().listProjects(orgId) };
  });

  app.get("/organizations/:orgId/projects/:projectId", async (req) => {
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    parseOrThrow(projectIdSchema, projectId, "project id is malformed");
    const project = await repo().getProject(orgId, projectId);
    if (!project) throw new TenantNotFoundError();
    return project;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes/organizations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/organizations.ts test/routes/organizations.test.ts
git commit -m "feat(PM-003): organization/project management routes"
```

---

### Task 8: Wire indexes, plugin, and routes into the app

**Files:**
- Modify: `src/lib/indexes.ts`
- Modify: `src/app.ts`
- Test: `test/lib/indexes.test.ts` (extend), `test/app.test.ts` (extend)

**Interfaces:**
- Consumes: `registerTenantContext` (Task 6), `registerOrganizationRoutes` (Task 7).
- Produces: `organizations` and `projects` index entries in `CORE_INDEXES` (or a sibling exported array `ROOT_INDEXES` merged into `ensureIndexes`); `buildApp` now registers the tenant-context plugin and organization routes.

  Design note: `CORE_INDEXES` currently maps only the 8 tenant-scoped collections and its test asserts exactly those 8. Add a separate `ROOT_INDEXES` array for `organizations`/`projects` and have `ensureIndexes` iterate both, so the existing `CORE_INDEXES` test stays valid and the two concepts (root vs tenant-scoped) stay distinct.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib/indexes.test.ts`:

```typescript
import { ROOT_INDEXES } from "../../src/lib/indexes.js";

describe("ROOT_INDEXES", () => {
  it("declares unique id indexes for organizations and projects, plus org lookup", () => {
    const byCol = Object.fromEntries(ROOT_INDEXES.map((e) => [e.collection, e.indexes]));
    expect(byCol.organizations.some((i) => i.name === "id_unique" && i.unique)).toBe(true);
    expect(byCol.projects.some((i) => i.name === "id_unique" && i.unique)).toBe(true);
    expect(byCol.projects.some((i) => i.name === "org_lookup")).toBe(true);
  });
});
```

Append to `test/app.test.ts` a check that the org route is wired. Note the existing `fakeDb()` only implements `command`; the org route calls `db.collection(...)`, so this test uses its own collection-capable db:

```typescript
import { vi } from "vitest";

describe("buildApp tenancy wiring", () => {
  it("exposes POST /organizations", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const db = {
      command: async () => ({ ok: 1 }),
      collection: () => ({ insertOne }),
    } as unknown as Db;
    const app = buildApp({ config: testConfig(), db });
    const res = await app.inject({ method: "POST", url: "/organizations", payload: { name: "Acme" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^org_/);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/lib/indexes.test.ts test/app.test.ts`
Expected: FAIL — `ROOT_INDEXES` not exported; `/organizations` route not registered.

- [ ] **Step 3: Implement — indexes**

In `src/lib/indexes.ts`, add after `CORE_INDEXES`:

```typescript
const ROOT_COLLECTION_INDEXES: ReadonlyArray<CollectionIndexes> = [
  {
    collection: "organizations",
    indexes: [{ key: { id: 1 }, name: "id_unique", unique: true }],
  },
  {
    collection: "projects",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      { key: { organizationId: 1 }, name: "org_lookup" },
    ],
  },
];

export const ROOT_INDEXES = ROOT_COLLECTION_INDEXES;
```

Then update `ensureIndexes` to iterate both arrays:

```typescript
export async function ensureIndexes(db: Db): Promise<void> {
  for (const { collection, indexes } of [...CORE_INDEXES, ...ROOT_INDEXES]) {
    await db.collection(collection).createIndexes(indexes as IndexDescription[]);
  }
}
```

- [ ] **Step 4: Implement — app wiring**

In `src/app.ts`, add imports and register calls inside `buildApp` after `registerHealthRoutes(app)`:

```typescript
import { registerTenantContext } from "./plugins/tenant-context.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";

// ...inside buildApp, after registerHealthRoutes(app):
registerTenantContext(app);
registerOrganizationRoutes(app);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/lib/indexes.test.ts test/app.test.ts`
Expected: PASS. The existing `CORE_INDEXES` 8-collection test still passes (unchanged).

- [ ] **Step 6: Full verification**

Run: `npm run check`
Expected: lint, typecheck, and all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/indexes.ts src/app.ts test/lib/indexes.test.ts test/app.test.ts
git commit -m "feat(PM-003): wire tenancy indexes, plugin, and routes into app"
```

---

### Task 9: End-to-end scoped-access proof

**Files:**
- Test: `test/modules/project-context/tenancy-e2e.test.ts`

**Interfaces:**
- Consumes: `scopedCollection` (Task 5), `resolveContext` (Task 4), `createRepository` (Task 3). No new production code — this task proves the header → context → scoped-access chain end to end against a mocked Db, satisfying the spec's "one tiny end-to-end test proving the mechanism."

- [ ] **Step 1: Write the test**

Create `test/modules/project-context/tenancy-e2e.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createRepository } from "../../../src/modules/project-context/repository.js";
import { resolveContext } from "../../../src/modules/project-context/context.js";
import { scopedCollection } from "../../../src/lib/scoped-collection.js";
import { newOrgId, newProjectId } from "../../../src/modules/project-context/entities.js";

const orgId = newOrgId();
const projId = newProjectId();

describe("header -> context -> scoped access", () => {
  it("resolves a project scope and applies it to a scoped read", async () => {
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const db = {
      collection: (name: string) => {
        if (name === "organizations") return { findOne: async () => ({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) };
        if (name === "projects") return { findOne: async () => ({ id: projId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }) };
        return { find };
      },
    } as unknown as Db;

    const ctx = await resolveContext(createRepository(db), { organizationId: orgId, projectId: projId });
    scopedCollection(db, "knowledge_items", ctx).find({ type: "Decision" });

    expect(find).toHaveBeenCalledWith({
      type: "Decision",
      organizationId: orgId,
      projectId: { $in: [projId, null] },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/modules/project-context/tenancy-e2e.test.ts`
Expected: PASS (the underlying units already exist).

- [ ] **Step 3: Final full verification**

Run: `npm run check`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add test/modules/project-context/tenancy-e2e.test.ts
git commit -m "test(PM-003): end-to-end tenancy scoped-access proof"
```

---

## Notes carried from the spec (reconciliations)

- **Error body shape / codes:** the spec's draft bodies (`{ error: "invalid_tenant_scope", ... }`) were illustrative. The real codebase uses `{ error: { code, message } }` with `SCREAMING_SNAKE` codes; this plan uses `INVALID_TENANT_SCOPE` / `TENANT_NOT_FOUND` accordingly. Behavior (400 vs non-leaking 404) is unchanged.
- **Test location:** spec said "co-located"; codebase convention is a parallel `test/` tree — plan follows the codebase.
- **Index wiring:** plan adds `ROOT_INDEXES` (not folding into `CORE_INDEXES`) to keep root vs tenant-scoped collections distinct and preserve the existing `CORE_INDEXES` test.
- **Deferred (unchanged from spec):** authorization + management-endpoint auth (PM-004), update/delete, pagination, global/cross-org tier, repo-to-project binding (PM-005), knowledge models (Epic 2).
