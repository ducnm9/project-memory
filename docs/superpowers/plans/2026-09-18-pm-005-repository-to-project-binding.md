# Repository-to-Project Binding (PM-005) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link a Git repository to a project via a `repositories` binding, expose org-scoped connect/list/resolve/unbind routes, and close the PM-004 cross-tenant hole on `:orgId` path routes.

**Architecture:** A new `src/modules/repository-binding/` module holds pure domain units (entity schemas, URL parser, persistence store, transport-agnostic resolver); `src/routes/repositories.ts` exposes four bearer-gated org-nested routes. The binding is a root `repositories` collection with a unique partial index over active bindings `(organizationId, url)`. `src/plugins/tenant-context.ts` is fixed once so the actor's organization must match **any** organization identifier on the request, including the `:orgId` path param.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), Fastify, MongoDB driver, Zod, `ulid`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-pm-005-repository-to-project-binding-design.md`

## Global Constraints

- Every relative import ends in `.js` (NodeNext ESM).
- No new dependencies (`zod`, `ulid`, `mongodb`, `fastify`, `vitest` are already present).
- Tests live under `test/` mirroring the `src/` path, named `*.test.ts`.
- Boundary validation uses Zod; ids use `ulid`; errors are `AppError` subclasses so `plugins/error-handler.ts` emits `{ error: { code, message } }`.
- TypeScript is `strict`; do not use non-null assertions (`!`) — guard and narrow instead.
- All new routes declare `config.auth: "bearer"` and take the organization from the `:orgId` path param.
- Never store the raw request URL — only the canonical form from `parseRepositoryUrl`.
- Commands: `npm run test`, `npm run typecheck`, `npm run lint`, `npm run check`.
- Commit style follows the repo: `feat(pm-005): …` / `test(pm-005): …`.

## File Structure

- `src/plugins/tenant-context.ts` — **modified**: enforce actor org against header **and** `:orgId` path param.
- `src/modules/repository-binding/entities.ts` — **new**: `Repository` type, id schema/generator, connector enum, connect body schema.
- `src/modules/repository-binding/url.ts` — **new**: `parseRepositoryUrl` (pure, no I/O).
- `src/modules/repository-binding/repository.ts` — **new**: `createRepositoryStore(db)` persistence.
- `src/modules/repository-binding/resolver.ts` — **new**: `resolveProjectByRepository` (MCP-reusable).
- `src/lib/indexes.ts` — **modified**: `repositories` root indexes.
- `src/lib/errors.ts` — **modified**: three repository error classes.
- `src/routes/repositories.ts` — **new**: four routes.
- `src/app.ts` — **modified**: register repository routes.

Task 1 is independent of Tasks 2–7 and may run in parallel (it touches only `tenant-context.ts` and its test).

---

### Task 1: Close the cross-tenant gap on `:orgId` path routes

**Files:**
- Modify: `src/plugins/tenant-context.ts`
- Test: `test/plugins/tenant-context.test.ts` (append)

**Interfaces:**
- Consumes: `ForbiddenScopeError`, `resolveContext` (existing).
- Produces: nothing new — same `registerTenantContext(app)` signature, stronger enforcement.

- [ ] **Step 1: Write the failing tests**

Append to `test/plugins/tenant-context.test.ts`. Add this builder alongside the existing ones (after `buildAppWithActor`):

```ts
function buildAppWithActorAtPath(db: Db, actorOrgId: string): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerErrorHandler(app);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { actor: unknown }).actor = {
      actorId: "tok_x", organizationId: actorOrgId, type: "service",
    };
  });
  registerTenantContext(app);
  app.get("/org/:orgId/probe", async (req) => ({ ctx: req.projectContext ?? null }));
  return app;
}
```

Append this suite at the end of the file:

```ts
describe("tenant-context path-param org enforcement", () => {
  it("rejects with 403 when the path org differs from the actor org and no header is sent", async () => {
    const other = newOrgId();
    const app = buildAppWithActorAtPath(dbOrgOnly(), other);
    const res = await app.inject({ method: "GET", url: `/org/${orgId}/probe` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });

  it("allows a path org matching the actor org when no header is sent", async () => {
    const app = buildAppWithActorAtPath(dbOrgOnly(), orgId);
    const res = await app.inject({ method: "GET", url: `/org/${orgId}/probe` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects with 403 when the header matches but the path org differs", async () => {
    const other = newOrgId();
    const app = buildAppWithActorAtPath(dbOrgOnly(), orgId);
    const res = await app.inject({
      method: "GET",
      url: `/org/${other}/probe`,
      headers: { "x-organization-id": orgId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- test/plugins/tenant-context.test.ts`
Expected: the three new tests FAIL — the first and third return `200` instead of `403`.

- [ ] **Step 3: Implement the fix**

Replace the body of the `app.addHook` in `src/plugins/tenant-context.ts` with:

```ts
  app.addHook("onRequest", async (req) => {
    const headerOrgId = header(req, "x-organization-id");
    const pathOrgId = (req.params as { orgId?: string } | undefined)?.orgId;

    // PM-005: every organization this request claims — header or path param —
    // must match the authenticated actor. Path-parameter routes carry their
    // scope in :orgId, so checking the header alone leaves them unenforced.
    if (req.actor) {
      for (const claimed of [headerOrgId, pathOrgId]) {
        if (claimed !== undefined && req.actor.organizationId !== claimed) {
          throw new ForbiddenScopeError("token not permitted for this organization");
        }
      }
    }

    if (headerOrgId === undefined) return; // no header → no context; path routes check existence themselves

    const repo = createRepository(app.db);
    req.projectContext = await resolveContext(repo, {
      organizationId: headerOrgId,
      projectId: header(req, "x-project-id"),
    });
  });
```

- [ ] **Step 4: Run the plugin tests and the existing auth e2e to verify no regression**

Run: `npm run test -- test/plugins/tenant-context.test.ts test/routes/auth-e2e.test.ts`
Expected: all PASS, including the pre-existing header-scoped tests, unmodified.

- [ ] **Step 5: Verify types and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/tenant-context.ts test/plugins/tenant-context.test.ts
git commit -m "fix(pm-005): enforce actor org on path-scoped tenant routes"
```

---

### Task 2: Repository entity, id, and connect schema

**Files:**
- Create: `src/modules/repository-binding/entities.ts`
- Test: `test/modules/repository-binding/entities.test.ts`

**Interfaces:**
- Consumes: `ulid`, `zod` (already dependencies).
- Produces: `Repository`, `RepositoryConnector`, `REPOSITORY_CONNECTORS`, `connectorSchema`, `repositoryIdSchema`, `newRepositoryId()`, `connectRepositoryBodySchema`.

- [ ] **Step 1: Write the failing test**

Create `test/modules/repository-binding/entities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  newRepositoryId,
  repositoryIdSchema,
  connectRepositoryBodySchema,
} from "../../../src/modules/repository-binding/entities.js";

describe("newRepositoryId", () => {
  it("produces a repo_-prefixed id that passes repositoryIdSchema", () => {
    const id = newRepositoryId();
    expect(id).toMatch(/^repo_/);
    expect(repositoryIdSchema.safeParse(id).success).toBe(true);
  });
});

describe("repositoryIdSchema", () => {
  it("rejects a malformed id", () => {
    expect(repositoryIdSchema.safeParse("repo_bad").success).toBe(false);
    expect(repositoryIdSchema.safeParse("proj_x").success).toBe(false);
  });
});

describe("connectRepositoryBodySchema", () => {
  it("accepts a url and trims it", () => {
    const r = connectRepositoryBodySchema.safeParse({ repositoryUrl: "  https://github.com/acme/x  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.repositoryUrl).toBe("https://github.com/acme/x");
  });

  it("rejects a missing or empty url", () => {
    expect(connectRepositoryBodySchema.safeParse({}).success).toBe(false);
    expect(connectRepositoryBodySchema.safeParse({ repositoryUrl: " " }).success).toBe(false);
  });

  it("rejects an unknown connector", () => {
    const r = connectRepositoryBodySchema.safeParse({ repositoryUrl: "https://x/y", connector: "svn" });
    expect(r.success).toBe(false);
  });

  it("accepts an optional branch and connector", () => {
    const r = connectRepositoryBodySchema.safeParse({
      repositoryUrl: "https://x/y", defaultBranch: "main", connector: "gitlab",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.defaultBranch).toBe("main");
      expect(r.data.connector).toBe("gitlab");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- test/modules/repository-binding/entities.test.ts`
Expected: FAIL — cannot resolve `entities.js`.

- [ ] **Step 3: Implement the entity**

Create `src/modules/repository-binding/entities.ts`:

```ts
import { ulid } from "ulid";
import { z } from "zod";

export const REPOSITORY_CONNECTORS = ["github", "gitlab", "bitbucket", "git"] as const;
export type RepositoryConnector = (typeof REPOSITORY_CONNECTORS)[number];

export interface Repository {
  id: string;
  organizationId: string;
  projectId: string;
  url: string;
  host: string;
  path: string;
  connector: RepositoryConnector;
  defaultBranch: string | null;
  createdAt: string;
  createdBy: string;
  unboundAt: string | null;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const repositoryIdSchema = z.string().regex(/^repo_[0-9A-HJKMNP-TV-Z]{26}$/);

export const connectorSchema = z.enum(REPOSITORY_CONNECTORS);

const nonEmpty = z.string().trim().min(1);

export const connectRepositoryBodySchema = z.object({
  repositoryUrl: nonEmpty,
  defaultBranch: nonEmpty.optional(),
  connector: connectorSchema.optional(),
});

export function newRepositoryId(): string {
  return `repo_${ulid()}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- test/modules/repository-binding/entities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/repository-binding/entities.ts test/modules/repository-binding/entities.test.ts
git commit -m "feat(pm-005): add repository entity and connect schema"
```

---

### Task 3: Repository URL normalization

**Files:**
- Create: `src/modules/repository-binding/url.ts`
- Test: `test/modules/repository-binding/url.test.ts`

**Interfaces:**
- Consumes: `RepositoryConnector` from Task 2.
- Produces: `ParsedRepository { url, host, path, connector }`, `parseRepositoryUrl(input: string): ParsedRepository | null`.

- [ ] **Step 1: Write the failing test**

Create `test/modules/repository-binding/url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRepositoryUrl } from "../../../src/modules/repository-binding/url.js";

describe("parseRepositoryUrl", () => {
  it("canonicalizes an https url", () => {
    expect(parseRepositoryUrl("https://github.com/acme/widgets")).toEqual({
      url: "https://github.com/acme/widgets",
      host: "github.com",
      path: "acme/widgets",
      connector: "github",
    });
  });

  it("strips a trailing .git", () => {
    expect(parseRepositoryUrl("https://github.com/acme/widgets.git")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("strips a trailing slash", () => {
    expect(parseRepositoryUrl("https://github.com/acme/widgets/")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("upgrades http to https in the canonical url", () => {
    expect(parseRepositoryUrl("http://github.com/acme/widgets")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("accepts scp-style git@host:owner/repo.git", () => {
    expect(parseRepositoryUrl("git@github.com:acme/widgets.git")).toEqual({
      url: "https://github.com/acme/widgets",
      host: "github.com",
      path: "acme/widgets",
      connector: "github",
    });
  });

  it("accepts ssh:// urls and strips userinfo", () => {
    const parsed = parseRepositoryUrl("ssh://git@gitlab.com/acme/widgets.git");
    expect(parsed?.url).toBe("https://gitlab.com/acme/widgets");
    expect(parsed?.connector).toBe("gitlab");
  });

  it("accepts git:// urls on bitbucket", () => {
    const parsed = parseRepositoryUrl("git://bitbucket.org/acme/widgets.git");
    expect(parsed?.url).toBe("https://bitbucket.org/acme/widgets");
    expect(parsed?.connector).toBe("bitbucket");
  });

  it("strips credentials from the url", () => {
    expect(parseRepositoryUrl("https://user:pass@github.com/acme/widgets")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("lowercases the host but preserves path case", () => {
    const parsed = parseRepositoryUrl("https://GitHub.com/Acme/Widgets");
    expect(parsed?.host).toBe("github.com");
    expect(parsed?.path).toBe("Acme/Widgets");
    expect(parsed?.url).toBe("https://github.com/Acme/Widgets");
  });

  it("infers a generic git connector for unknown hosts", () => {
    expect(parseRepositoryUrl("https://git.mycorp.io/team/repo.git")?.connector).toBe("git");
  });

  it("rejects malformed input", () => {
    expect(parseRepositoryUrl("")).toBeNull();
    expect(parseRepositoryUrl("not a url")).toBeNull();
    expect(parseRepositoryUrl("https://github.com")).toBeNull();
    expect(parseRepositoryUrl("ftp://github.com/a/b")).toBeNull();
  });

  it("rejects scheme-without-// and non-host left sides", () => {
    expect(parseRepositoryUrl("https:github.com/acme/widgets")).toBeNull();
    expect(parseRepositoryUrl("http:/github.com/acme/widgets")).toBeNull();
    expect(parseRepositoryUrl("foo:bar")).toBeNull();
    expect(parseRepositoryUrl("C:/Users/x")).toBeNull();
  });

  it("accepts a dotted host:path scp form without a user", () => {
    expect(parseRepositoryUrl("github.com:acme/widgets")?.url)
      .toBe("https://github.com/acme/widgets");
  });

  it("rejects a malformed host", () => {
    expect(parseRepositoryUrl("https://-foo.com/a/b")).toBeNull();
    expect(parseRepositoryUrl("foo..com:acme/x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- test/modules/repository-binding/url.test.ts`
Expected: FAIL — cannot resolve `url.js`.

- [ ] **Step 3: Implement the parser**

Create `src/modules/repository-binding/url.ts`:

```ts
import { type RepositoryConnector } from "./entities.js";

export interface ParsedRepository {
  url: string;
  host: string;
  path: string;
  connector: RepositoryConnector;
}

const SCP_LIKE = /^(?:([^@/\s]+)@)?([^:/\s]+):([^\s]+)$/;
const HOST = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function inferConnector(host: string): RepositoryConnector {
  switch (host) {
    case "github.com":
      return "github";
    case "gitlab.com":
      return "gitlab";
    case "bitbucket.org":
      return "bitbucket";
    default:
      return "git";
  }
}

/**
 * Normalizes every supported repository URL form to
 * `https://<host>/<path>`. Returns null when there is no usable host or path.
 * No network access: format validation only.
 */
export function parseRepositoryUrl(input: string): ParsedRepository | null {
  const raw = input.trim();
  if (raw.length === 0) return null;

  let host: string;
  let pathPart: string;

  if (raw.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    const allowed = ["http:", "https:", "ssh:", "git:"];
    if (!allowed.includes(parsed.protocol)) return null;
    host = parsed.hostname;
    pathPart = parsed.pathname;
  } else {
    const scp = raw.match(SCP_LIKE);
    if (!scp) return null;
    const user = scp[1];
    const scpHost = scp[2];
    const scpPath = scp[3];
    // The no-user `host:path` form requires a dotted host, so
    // scheme-without-`//` input (`https:foo/bar`), `C:/x`, and `word:rest`
    // are rejected instead of being read as a host.
    if (!user && !scpHost.includes(".")) return null;
    host = scpHost;
    pathPart = scpPath;
  }

  host = host.toLowerCase();
  pathPart = pathPart.replace(/^\/+/, "").replace(/\/+$/, "");
  if (pathPart.toLowerCase().endsWith(".git")) pathPart = pathPart.slice(0, -4);
  pathPart = pathPart.replace(/\/+$/, "");

  if (host.length === 0 || pathPart.length === 0) return null;
  if (!HOST.test(host)) return null;

  return {
    url: `https://${host}/${pathPart}`,
    host,
    path: pathPart,
    connector: inferConnector(host),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- test/modules/repository-binding/url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/repository-binding/url.ts test/modules/repository-binding/url.test.ts
git commit -m "feat(pm-005): add repository url parser"
```

---

### Task 4: Binding store and indexes

**Files:**
- Create: `src/modules/repository-binding/repository.ts`
- Modify: `src/lib/indexes.ts` (append a `repositories` entry to `ROOT_COLLECTION_INDEXES`)
- Test: `test/modules/repository-binding/repository.test.ts`, `test/lib/indexes.test.ts` (append)

**Interfaces:**
- Consumes: `Repository`, `RepositoryConnector`, `newRepositoryId` from Task 2.
- Produces: `CreateRepositoryInput`, `RepositoryStore`, `createRepositoryStore(db)` with `createRepository(input)`, `findActiveByUrl(organizationId, url)`, `listActiveByProject(organizationId, projectId)`, `markUnbound(organizationId, projectId, id)`.

- [ ] **Step 1: Write the failing store test**

Create `test/modules/repository-binding/repository.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createRepositoryStore } from "../../../src/modules/repository-binding/repository.js";

const base = {
  organizationId: "org_A",
  projectId: "proj_P",
  url: "https://github.com/acme/widgets",
  host: "github.com",
  path: "acme/widgets",
  connector: "github" as const,
  defaultBranch: null,
  createdBy: "tok_1",
};

function mockDb(handlers: Record<string, unknown>) {
  const collection = vi.fn((name: string) => handlers[name]);
  return { db: { collection } as unknown as Db, collection };
}

describe("createRepository", () => {
  it("inserts a binding with a generated id, timestamps, and null unboundAt", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const { db } = mockDb({ repositories: { insertOne } });
    const store = createRepositoryStore(db);
    const repository = await store.createRepository(base);
    expect(repository.id).toMatch(/^repo_/);
    expect(repository.unboundAt).toBeNull();
    expect(repository.createdAt).toBeTruthy();
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: repository.id, ...base, unboundAt: null }),
    );
  });
});

describe("findActiveByUrl", () => {
  it("queries the active binding for the org and canonical url", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const { db } = mockDb({ repositories: { findOne } });
    await createRepositoryStore(db).findActiveByUrl("org_A", "https://github.com/acme/widgets");
    expect(findOne).toHaveBeenCalledWith(
      { organizationId: "org_A", url: "https://github.com/acme/widgets", unboundAt: null },
      { projection: { _id: 0 } },
    );
  });
});

describe("listActiveByProject", () => {
  it("queries active bindings for the org and project", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const { db } = mockDb({ repositories: { find } });
    await createRepositoryStore(db).listActiveByProject("org_A", "proj_P");
    expect(find).toHaveBeenCalledWith(
      { organizationId: "org_A", projectId: "proj_P", unboundAt: null },
      { projection: { _id: 0 } },
    );
  });
});

describe("markUnbound", () => {
  it("returns true when an active binding was unbound", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const { db } = mockDb({ repositories: { updateOne } });
    await expect(createRepositoryStore(db).markUnbound("org_A", "proj_P", "repo_1"))
      .resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { id: "repo_1", organizationId: "org_A", projectId: "proj_P", unboundAt: null },
      { $set: { unboundAt: expect.any(String) } },
    );
  });

  it("returns false when no active binding matched", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const { db } = mockDb({ repositories: { updateOne } });
    await expect(createRepositoryStore(db).markUnbound("org_A", "proj_P", "repo_1"))
      .resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- test/modules/repository-binding/repository.test.ts`
Expected: FAIL — cannot resolve `repository.js`.

- [ ] **Step 3: Implement the store**

Create `src/modules/repository-binding/repository.ts`:

```ts
import type { Db } from "mongodb";
import { newRepositoryId, type Repository, type RepositoryConnector } from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateRepositoryInput {
  organizationId: string;
  projectId: string;
  url: string;
  host: string;
  path: string;
  connector: RepositoryConnector;
  defaultBranch: string | null;
  createdBy: string;
}

export interface RepositoryStore {
  createRepository(input: CreateRepositoryInput): Promise<Repository>;
  findActiveByUrl(organizationId: string, url: string): Promise<Repository | null>;
  listActiveByProject(organizationId: string, projectId: string): Promise<Repository[]>;
  markUnbound(organizationId: string, projectId: string, id: string): Promise<boolean>;
}

export function createRepositoryStore(db: Db): RepositoryStore {
  const col = () => db.collection<Repository>("repositories");

  return {
    async createRepository(input) {
      const repository: Repository = {
        id: newRepositoryId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        url: input.url,
        host: input.host,
        path: input.path,
        connector: input.connector,
        defaultBranch: input.defaultBranch,
        createdAt: new Date().toISOString(),
        createdBy: input.createdBy,
        unboundAt: null,
      };
      await col().insertOne(repository);
      return repository;
    },
    async findActiveByUrl(organizationId, url) {
      return col().findOne(
        { organizationId, url, unboundAt: null },
        READ_OPTS,
      ) as Promise<Repository | null>;
    },
    async listActiveByProject(organizationId, projectId) {
      return col()
        .find({ organizationId, projectId, unboundAt: null }, READ_OPTS)
        .toArray() as Promise<Repository[]>;
    },
    async markUnbound(organizationId, projectId, id) {
      const res = await col().updateOne(
        { id, organizationId, projectId, unboundAt: null },
        { $set: { unboundAt: new Date().toISOString() } },
      );
      return res.matchedCount > 0;
    },
  };
}
```

- [ ] **Step 4: Write the failing index test**

Append to `test/lib/indexes.test.ts`:

```ts
describe("repositories indexes", () => {
  it("declares unique id, unique active url, and project lookup", () => {
    const entry = ROOT_INDEXES.find((c) => c.collection === "repositories");
    expect(entry).toBeDefined();
    const names = entry!.indexes.map((i) => i.name);
    expect(names).toContain("id_unique");
    expect(names).toContain("active_url_unique");
    expect(names).toContain("project_lookup");

    const activeUrl = entry!.indexes.find((i) => i.name === "active_url_unique");
    expect(activeUrl!.unique).toBe(true);
    expect(activeUrl!.partialFilterExpression).toEqual({ unboundAt: null });
  });
});
```

- [ ] **Step 5: Run the index test to verify it fails**

Run: `npm run test -- test/lib/indexes.test.ts`
Expected: FAIL — `repositories` entry is undefined.

- [ ] **Step 6: Add the indexes**

In `src/lib/indexes.ts`, insert this entry into `ROOT_COLLECTION_INDEXES` after the `service_tokens` entry:

```ts
  {
    collection: "repositories",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: { organizationId: 1, url: 1 },
        name: "active_url_unique",
        unique: true,
        partialFilterExpression: { unboundAt: null },
      },
      { key: { organizationId: 1, projectId: 1 }, name: "project_lookup" },
    ],
  },
```

- [ ] **Step 7: Run both tests to verify they pass**

Run: `npm run test -- test/modules/repository-binding/repository.test.ts test/lib/indexes.test.ts`
Expected: PASS (including the pre-existing `ensureIndexes` count assertions, which derive from the table).

- [ ] **Step 8: Commit**

```bash
git add src/modules/repository-binding/repository.ts src/lib/indexes.ts \
  test/modules/repository-binding/repository.test.ts test/lib/indexes.test.ts
git commit -m "feat(pm-005): add repository binding store and indexes"
```

---

### Task 5: Project resolver by repository URL

**Files:**
- Create: `src/modules/repository-binding/resolver.ts`
- Test: `test/modules/repository-binding/resolver.test.ts`

**Interfaces:**
- Consumes: `parseRepositoryUrl` (Task 3), `RepositoryStore` (Task 4).
- Produces: `ResolvedRepository { repositoryId, projectId }`, `resolveProjectByRepository(store, organizationId, repositoryUrl): Promise<ResolvedRepository | null>`.

- [ ] **Step 1: Write the failing test**

Create `test/modules/repository-binding/resolver.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveProjectByRepository } from "../../../src/modules/repository-binding/resolver.js";
import type { RepositoryStore } from "../../../src/modules/repository-binding/repository.js";

function storeReturning(binding: unknown) {
  const findActiveByUrl = vi.fn().mockResolvedValue(binding);
  const store = {
    createRepository: vi.fn(),
    findActiveByUrl,
    listActiveByProject: vi.fn(),
    markUnbound: vi.fn(),
  } as unknown as RepositoryStore;
  return { store, findActiveByUrl };
}

describe("resolveProjectByRepository", () => {
  it("resolves a bound url to its project and repository", async () => {
    const { store } = storeReturning({ id: "repo_1", projectId: "proj_P", unboundAt: null });
    await expect(
      resolveProjectByRepository(store, "org_A", "https://github.com/acme/widgets.git"),
    ).resolves.toEqual({ repositoryId: "repo_1", projectId: "proj_P" });
  });

  it("normalizes the incoming url before lookup", async () => {
    const { store, findActiveByUrl } = storeReturning(null);
    await resolveProjectByRepository(store, "org_A", "git@github.com:acme/widgets.git");
    expect(findActiveByUrl).toHaveBeenCalledWith("org_A", "https://github.com/acme/widgets");
  });

  it("scopes the lookup to the organization", async () => {
    const { store, findActiveByUrl } = storeReturning(null);
    await resolveProjectByRepository(store, "org_OTHER", "https://github.com/acme/widgets");
    expect(findActiveByUrl).toHaveBeenCalledWith("org_OTHER", "https://github.com/acme/widgets");
  });

  it("returns null when the repository is not bound", async () => {
    const { store } = storeReturning(null);
    await expect(
      resolveProjectByRepository(store, "org_A", "https://github.com/acme/widgets"),
    ).resolves.toBeNull();
  });

  it("returns null for a malformed url without touching the store", async () => {
    const { store, findActiveByUrl } = storeReturning(null);
    await expect(resolveProjectByRepository(store, "org_A", "not a url")).resolves.toBeNull();
    expect(findActiveByUrl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- test/modules/repository-binding/resolver.test.ts`
Expected: FAIL — cannot resolve `resolver.js`.

- [ ] **Step 3: Implement the resolver**

Create `src/modules/repository-binding/resolver.ts`:

```ts
import { parseRepositoryUrl } from "./url.js";
import type { RepositoryStore } from "./repository.js";

export interface ResolvedRepository {
  repositoryId: string;
  projectId: string;
}

/**
 * Maps a repository URL to its bound project within one organization.
 * Organization-scoped by construction, and free of HTTP state, so the same
 * function backs the HTTP resolve route and the future MCP `project.resolve`.
 */
export async function resolveProjectByRepository(
  store: RepositoryStore,
  organizationId: string,
  repositoryUrl: string,
): Promise<ResolvedRepository | null> {
  const parsed = parseRepositoryUrl(repositoryUrl);
  if (!parsed) return null;

  const binding = await store.findActiveByUrl(organizationId, parsed.url);
  if (!binding) return null;

  return { repositoryId: binding.id, projectId: binding.projectId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- test/modules/repository-binding/resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/repository-binding/resolver.ts test/modules/repository-binding/resolver.test.ts
git commit -m "feat(pm-005): add project resolver by repository url"
```

---

### Task 6: Error classes and HTTP routes

**Files:**
- Modify: `src/lib/errors.ts` (append three classes), `src/app.ts` (register routes)
- Create: `src/routes/repositories.ts`
- Test: `test/routes/repositories.test.ts`

**Interfaces:**
- Consumes: `connectRepositoryBodySchema`, `repositoryIdSchema`, `Repository`, `RepositoryConnector` (Task 2); `parseRepositoryUrl` (Task 3); `createRepositoryStore` (Task 4); `resolveProjectByRepository` (Task 5); `createRepository` + `orgIdSchema`/`projectIdSchema` from `project-context`.
- Produces: `InvalidRepositoryUrlError`, `RepositoryConflictError`, `RepositoryNotFoundError`, `registerRepositoryRoutes(app)`.

- [ ] **Step 1: Write the failing routes test**

Create `test/routes/repositories.test.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { registerRepositoryRoutes } from "../../src/routes/repositories.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";
import { newRepositoryId } from "../../src/modules/repository-binding/entities.js";

const orgId = newOrgId();
const projectId = newProjectId();
const repositoryId = newRepositoryId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };
const collectionUrl = `/organizations/${orgId}/projects/${projectId}/repositories`;

function buildApp(handlers: Record<string, Record<string, unknown>>): FastifyInstance {
  const app = Fastify({ logger: false });
  const db = { collection: (n: string) => handlers[n] ?? {} } as unknown as Db;
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { actor: unknown }).actor = {
      actorId: "tok_1", organizationId: orgId, type: "service",
    };
  });
  registerErrorHandler(app);
  registerRepositoryRoutes(app);
  return app;
}

describe("POST .../repositories", () => {
  it("binds a repository and returns 201 with the canonical url", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: { findOne: vi.fn().mockResolvedValue(null), insertOne },
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl,
      payload: { repositoryUrl: "https://github.com/acme/widgets.git" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^repo_/);
    expect(res.json().url).toBe("https://github.com/acme/widgets");
    expect(res.json().projectId).toBe(projectId);
    expect(res.json().createdBy).toBe("tok_1");
    await app.close();
  });

  it("is idempotent (200) when the same url is already bound to the same project", async () => {
    const existing = {
      id: repositoryId, organizationId: orgId, projectId,
      url: "https://github.com/acme/widgets", host: "github.com", path: "acme/widgets",
      connector: "github", defaultBranch: null, createdAt: "", createdBy: "tok_1", unboundAt: null,
    };
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: { findOne: vi.fn().mockResolvedValue(existing), insertOne: vi.fn() },
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(repositoryId);
    await app.close();
  });

  it("returns 409 when the same url is bound to a different project", async () => {
    const existing = {
      id: repositoryId, organizationId: orgId, projectId: newProjectId(),
      url: "https://github.com/acme/widgets", unboundAt: null,
    };
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: { findOne: vi.fn().mockResolvedValue(existing), insertOne: vi.fn() },
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REPOSITORY_ALREADY_BOUND");
    await app.close();
  });

  it("returns 400 INVALID_REPOSITORY_URL for a malformed url", async () => {
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: {},
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "not a url" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REPOSITORY_URL");
    await app.close();
  });

  it("returns 400 INVALID_REPOSITORY_URL when the body has no repositoryUrl", async () => {
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: {},
    });
    const res = await app.inject({ method: "POST", url: collectionUrl, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REPOSITORY_URL");
    await app.close();
  });

  it("returns 404 when the project does not exist in the org", async () => {
    const app = buildApp({ projects: { findOne: vi.fn().mockResolvedValue(null) }, repositories: {} });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TENANT_NOT_FOUND");
    await app.close();
  });

  it("maps a duplicate-key race onto the idempotent branch", async () => {
    const existing = {
      id: repositoryId, organizationId: orgId, projectId,
      url: "https://github.com/acme/widgets", unboundAt: null,
    };
    const dup = Object.assign(new Error("duplicate"), { code: 11000 });
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: {
        findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(existing),
        insertOne: vi.fn().mockRejectedValue(dup),
      },
    });
    const res = await app.inject({
      method: "POST", url: collectionUrl, payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(repositoryId);
    await app.close();
  });
});

describe("GET .../repositories", () => {
  it("lists active bindings for the project", async () => {
    const toArray = vi.fn().mockResolvedValue([{ id: repositoryId, projectId }]);
    const app = buildApp({
      projects: { findOne: vi.fn().mockResolvedValue(project) },
      repositories: { find: vi.fn().mockReturnValue({ toArray }) },
    });
    const res = await app.inject({ method: "GET", url: collectionUrl });
    expect(res.statusCode).toBe(200);
    expect(res.json().repositories).toHaveLength(1);
    await app.close();
  });
});

describe("GET /organizations/:orgId/repositories/resolve", () => {
  const resolveUrl = (raw: string) =>
    `/organizations/${orgId}/repositories/resolve?repositoryUrl=${encodeURIComponent(raw)}`;

  it("returns the project for a bound repository", async () => {
    const app = buildApp({ repositories: { findOne: vi.fn().mockResolvedValue({ id: repositoryId, projectId }) } });
    const res = await app.inject({ method: "GET", url: resolveUrl("https://github.com/acme/widgets.git") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ organizationId: orgId, projectId, repositoryId });
    await app.close();
  });

  it("returns 404 when the repository is not bound", async () => {
    const app = buildApp({ repositories: { findOne: vi.fn().mockResolvedValue(null) } });
    const res = await app.inject({ method: "GET", url: resolveUrl("https://github.com/acme/widgets") });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("REPOSITORY_NOT_FOUND");
    await app.close();
  });

  it("returns 400 for a malformed repository url", async () => {
    const app = buildApp({ repositories: {} });
    const res = await app.inject({ method: "GET", url: resolveUrl("nope") });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REPOSITORY_URL");
    await app.close();
  });
});

describe("DELETE .../repositories/:repositoryId", () => {
  it("soft-unbinds and returns 204", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const app = buildApp({ repositories: { updateOne } });
    const res = await app.inject({ method: "DELETE", url: `${collectionUrl}/${repositoryId}` });
    expect(res.statusCode).toBe(204);
    expect(updateOne).toHaveBeenCalledWith(
      { id: repositoryId, organizationId: orgId, projectId, unboundAt: null },
      { $set: { unboundAt: expect.any(String) } },
    );
    await app.close();
  });

  it("returns 404 when no active binding matched", async () => {
    const app = buildApp({ repositories: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) } });
    const res = await app.inject({ method: "DELETE", url: `${collectionUrl}/${repositoryId}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("REPOSITORY_NOT_FOUND");
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- test/routes/repositories.test.ts`
Expected: FAIL — cannot resolve `routes/repositories.js`.

- [ ] **Step 3: Add the error classes**

Append to `src/lib/errors.ts`:

```ts
export class InvalidRepositoryUrlError extends AppError {
  constructor(message = "repository url is missing or malformed") {
    super(message, 400, "INVALID_REPOSITORY_URL");
  }
}

export class RepositoryConflictError extends AppError {
  constructor(message = "repository is already bound to a different project") {
    super(message, 409, "REPOSITORY_ALREADY_BOUND");
  }
}

export class RepositoryNotFoundError extends AppError {
  constructor(message = "repository binding not found") {
    super(message, 404, "REPOSITORY_NOT_FOUND");
  }
}
```

- [ ] **Step 4: Implement the routes**

Create `src/routes/repositories.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { orgIdSchema, projectIdSchema } from "../modules/project-context/entities.js";
import {
  connectRepositoryBodySchema,
  repositoryIdSchema,
  type Repository,
} from "../modules/repository-binding/entities.js";
import { createRepositoryStore } from "../modules/repository-binding/repository.js";
import { parseRepositoryUrl } from "../modules/repository-binding/url.js";
import { resolveProjectByRepository } from "../modules/repository-binding/resolver.js";
import {
  InvalidRepositoryUrlError,
  InvalidTenantScopeError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
} from "../lib/errors.js";

const DUPLICATE_KEY = 11000;

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  msg: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new InvalidTenantScopeError(msg);
  return r.data as T;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY
  );
}

function respondToExisting(existing: Repository, projectId: string, reply: FastifyReply): Repository {
  if (existing.projectId !== projectId) throw new RepositoryConflictError();
  reply.status(200);
  return existing;
}

export function registerRepositoryRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createRepositoryStore(app.db);

  async function requireProject(orgId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(orgId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/organizations/:orgId/projects/:projectId/repositories", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");

    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    parseOrThrow(projectIdSchema, projectId, "project id is malformed");
    const parsedBody = connectRepositoryBodySchema.safeParse(req.body);
    if (!parsedBody.success) throw new InvalidRepositoryUrlError();
    const body = parsedBody.data;

    await requireProject(orgId, projectId);

    const parsed = parseRepositoryUrl(body.repositoryUrl);
    if (!parsed) throw new InvalidRepositoryUrlError();

    const existing = await store().findActiveByUrl(orgId, parsed.url);
    if (existing) return respondToExisting(existing, projectId, reply);

    try {
      const repository = await store().createRepository({
        organizationId: orgId,
        projectId,
        url: parsed.url,
        host: parsed.host,
        path: parsed.path,
        connector: body.connector ?? parsed.connector,
        defaultBranch: body.defaultBranch ?? null,
        createdBy: actor.actorId,
      });
      reply.status(201);
      return repository;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const raced = await store().findActiveByUrl(orgId, parsed.url);
      if (!raced) throw err;
      return respondToExisting(raced, projectId, reply);
    }
  });

  app.get("/organizations/:orgId/projects/:projectId/repositories", BEARER, async (req) => {
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    parseOrThrow(projectIdSchema, projectId, "project id is malformed");
    await requireProject(orgId, projectId);
    return { repositories: await store().listActiveByProject(orgId, projectId) };
  });

  app.get("/organizations/:orgId/repositories/resolve", BEARER, async (req) => {
    const { orgId } = req.params as { orgId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");

    const { repositoryUrl } = req.query as { repositoryUrl?: string };
    if (typeof repositoryUrl !== "string" || repositoryUrl.trim().length === 0) {
      throw new InvalidRepositoryUrlError();
    }
    if (!parseRepositoryUrl(repositoryUrl)) throw new InvalidRepositoryUrlError();

    const resolved = await resolveProjectByRepository(store(), orgId, repositoryUrl);
    if (!resolved) throw new RepositoryNotFoundError();
    return { organizationId: orgId, ...resolved };
  });

  app.delete(
    "/organizations/:orgId/projects/:projectId/repositories/:repositoryId",
    BEARER,
    async (req, reply) => {
      const { orgId, projectId, repositoryId } = req.params as {
        orgId: string;
        projectId: string;
        repositoryId: string;
      };
      parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
      parseOrThrow(projectIdSchema, projectId, "project id is malformed");
      parseOrThrow(repositoryIdSchema, repositoryId, "repository id is malformed");

      const unbound = await store().markUnbound(orgId, projectId, repositoryId);
      if (!unbound) throw new RepositoryNotFoundError();
      reply.status(204);
      return null;
    },
  );
}
```

- [ ] **Step 5: Register the routes**

In `src/app.ts`, add the import and the registration after `registerOrganizationRoutes(app)`:

```ts
import { registerRepositoryRoutes } from "./routes/repositories.js";
```

```ts
  registerOrganizationRoutes(app);
  registerRepositoryRoutes(app);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -- test/routes/repositories.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify types and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/errors.ts src/routes/repositories.ts src/app.ts test/routes/repositories.test.ts
git commit -m "feat(pm-005): add repository binding routes"
```

---

### Task 7: End-to-end isolation test

**Files:**
- Test: `test/routes/repositories-e2e.test.ts`

**Interfaces:**
- Consumes: `buildApp` (`src/app.ts`), `newOrgId`/`newProjectId`, the `AppConfig` shape.
- Produces: nothing (verification only).

- [ ] **Step 1: Write the e2e test**

Create `test/routes/repositories-e2e.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/index.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();
const otherOrgId = newOrgId();
const projectId = newProjectId();

const config = {
  port: 0, host: "0.0.0.0", nodeEnv: "test", logLevel: "silent",
  mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "admin-secret", authTokenPepper: "pepper",
} as AppConfig;

function mockDb(): Db {
  return {
    collection: (name: string) => {
      if (name === "service_tokens") {
        return {
          findOne: vi.fn().mockResolvedValue({
            id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x",
            hashedSecret: "h", createdAt: "", revokedAt: null,
          }),
        };
      }
      if (name === "organizations") {
        return { findOne: vi.fn().mockResolvedValue({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) };
      }
      if (name === "projects") {
        return {
          findOne: vi.fn().mockResolvedValue({
            id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "",
          }),
        };
      }
      if (name === "repositories") {
        return { findOne: vi.fn().mockResolvedValue(null), insertOne: vi.fn().mockResolvedValue({}) };
      }
      return { findOne: vi.fn().mockResolvedValue(null) };
    },
  } as unknown as Db;
}

describe("repository binding end-to-end", () => {
  it("rejects a path-scoped binding request for another org when the header is omitted", async () => {
    const app = buildApp({ config, db: mockDb() });
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${otherOrgId}/projects/${projectId}/repositories`,
      headers: { authorization: "Bearer pmk_any" },
      payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });

  it("binds a repository inside the caller's own org", async () => {
    const app = buildApp({ config, db: mockDb() });
    const res = await app.inject({
      method: "POST",
      url: `/organizations/${orgId}/projects/${projectId}/repositories`,
      headers: { authorization: "Bearer pmk_any" },
      payload: { repositoryUrl: "https://github.com/acme/widgets" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^repo_/);
    await app.close();
  });
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npm run test -- test/routes/repositories-e2e.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full check**

Run: `npm run check`
Expected: lint, typecheck, and the whole test suite PASS.

- [ ] **Step 4: Commit**

```bash
git add test/routes/repositories-e2e.test.ts
git commit -m "test(pm-005): end-to-end repository binding and org isolation"
```

---

## Verification Checklist (run before declaring done)

- [ ] `npm run check` passes (lint + typecheck + full test suite).
- [ ] `test/plugins/tenant-context.test.ts` still passes with its original header-scoped tests unmodified.
- [ ] The e2e test proves a token for org A cannot bind in org B **without** sending `x-organization-id`.
- [ ] `ROOT_INDEXES` declares `repositories` with `id_unique`, unique partial `active_url_unique` (`partialFilterExpression: { unboundAt: null }`), and `project_lookup`.
- [ ] No raw repository URL is stored: every persisted `url` is the `parseRepositoryUrl` canonical form.
- [ ] No new dependency was added to `package.json`.
