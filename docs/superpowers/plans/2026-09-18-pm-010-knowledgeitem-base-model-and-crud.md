# KnowledgeItem Base Model and CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the canonical `KnowledgeItem` entity, its lifecycle state machine, a tenant-scoped MongoDB repository, and CRUD HTTP routes.

**Architecture:** A new `src/modules/knowledge-core/` module holding pure data (`entities.ts`), a pure state machine (`lifecycle.ts`), and a persistence store (`repository.ts`), plus `src/routes/knowledge.ts` composing them behind the existing Fastify error handler, bearer auth, and tenant-context plugins. Every query is organization-scoped; typed per-type content contracts (PM-011) and versioning (PM-012) are deferred.

**Tech Stack:** TypeScript (ESM, `NodeNext`), Node ≥ 20.19, Fastify 5, MongoDB driver 7, Zod 3.23, `ulid`, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-18-pm-010-knowledgeitem-base-model-and-crud-design.md`

## Global Constraints

- **No new dependencies.** Reuse `zod`, `ulid`, `mongodb`, `fastify` already in `package.json`.
- **ESM imports must carry the `.js` suffix** (e.g. `./entities.js`), because `moduleResolution` is `NodeNext`.
- **Strict TypeScript.** `npm run typecheck` and `npm run lint` must pass; no `any` where a type exists.
- **Tests:** Vitest; run the whole suite with `npm run test`. No Mongo test server — use the in-memory fake `Db` (Task 4).
- **Error mapping:** `400 VALIDATION_ERROR` (malformed ids/fields/filters, missing org context is `400 INVALID_TENANT_SCOPE`), `404 TENANT_NOT_FOUND` / `KNOWLEDGE_NOT_FOUND`, `422 INVALID_KNOWLEDGE_TYPE` / `INVALID_STATUS_TRANSITION`, `403 FORBIDDEN_SCOPE`.
- **`organizationId` and `ownerId` are always server-derived** from `req.projectContext` / `req.actor`; never read them from a request body.
- **Commit style:** `feat(pm-010): <summary>` (repo convention).
- **Status set:** `DISCOVERED, PROPOSED, VALIDATING, ACCEPTED, PUBLISHED, UPDATED, STALE, DEPRECATED, REJECTED`.
- **Type set:** `Decision, Concept, Procedure, Troubleshooting, Investigation, Architecture` (no `Fact`).

---

### Task 1: KnowledgeItem model and error classes

**Files:**
- Modify: `src/lib/errors.ts` (append three classes)
- Create: `src/modules/knowledge-core/entities.ts`
- Modify: `test/lib/errors.test.ts` (append a `knowledge errors` block)
- Test: `test/modules/knowledge-core/entities.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `KNOWLEDGE_TYPES: readonly ["Decision","Concept","Procedure","Troubleshooting","Investigation","Architecture"]`, `type KnowledgeType`
  - `KNOWLEDGE_STATUSES: readonly KnowledgeStatus[]`, `type KnowledgeStatus`
  - `interface KnowledgeItem { id: string; organizationId: string; projectId: string; type: KnowledgeType; title: string; summary: string; content: Record<string, unknown>; status: KnowledgeStatus; version: number; ownerId: string; createdAt: string; updatedAt: string; lastVerifiedAt: string | null }`
  - `knowledgeIdSchema`, `knowledgeTypeSchema`, `knowledgeStatusSchema`
  - `createKnowledgeItemBodySchema` (content defaults to `{}`), `updateKnowledgeItemBodySchema` (strict, all fields optional)
  - `newKnowledgeItemId(): string`
  - `KnowledgeNotFoundError`, `InvalidKnowledgeTypeError`, `InvalidStatusTransitionError(from, to)`

- [ ] **Step 1: Write the failing entities test**

Create `test/modules/knowledge-core/entities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_TYPES,
  createKnowledgeItemBodySchema,
  knowledgeIdSchema,
  newKnowledgeItemId,
  updateKnowledgeItemBodySchema,
} from "../../../src/modules/knowledge-core/entities.js";

describe("knowledgeIdSchema", () => {
  it("accepts a generated id", () => {
    expect(knowledgeIdSchema.safeParse(newKnowledgeItemId()).success).toBe(true);
  });

  it("rejects other prefixes and malformed bodies", () => {
    expect(knowledgeIdSchema.safeParse("repo_01H").success).toBe(false);
    expect(knowledgeIdSchema.safeParse("know_lowercase").success).toBe(false);
  });
});

describe("createKnowledgeItemBodySchema", () => {
  const valid = { projectId: "proj_x", type: "Decision", title: "t", summary: "s" };

  it("defaults content to an empty object and leaves status unset", () => {
    const r = createKnowledgeItemBodySchema.parse(valid);
    expect(r.content).toEqual({});
    expect(r.status).toBeUndefined();
  });

  it("knows its six types, in order", () => {
    expect(KNOWLEDGE_TYPES).toEqual([
      "Decision", "Concept", "Procedure", "Troubleshooting", "Investigation", "Architecture",
    ]);
  });

  it("rejects an unknown type", () => {
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, type: "Fact" }).success).toBe(false);
  });

  it("rejects missing or blank required fields", () => {
    expect(createKnowledgeItemBodySchema.safeParse({ type: "Decision", title: "t", summary: "s" }).success).toBe(false);
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, summary: "" }).success).toBe(false);
  });

  it("rejects unknown top-level keys (server-derived fields)", () => {
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, ownerId: "tok_x" }).success).toBe(false);
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, organizationId: "org_x" }).success).toBe(false);
  });

  it("accepts an optional status", () => {
    expect(createKnowledgeItemBodySchema.safeParse({ ...valid, status: "PROPOSED" }).success).toBe(true);
  });
});

describe("updateKnowledgeItemBodySchema", () => {
  it("accepts an empty object (the route enforces non-empty)", () => {
    expect(updateKnowledgeItemBodySchema.safeParse({}).success).toBe(true);
  });

  it("accepts a status-only patch", () => {
    expect(updateKnowledgeItemBodySchema.safeParse({ status: "PROPOSED" }).success).toBe(true);
  });

  it("rejects immutable fields", () => {
    expect(updateKnowledgeItemBodySchema.safeParse({ type: "Concept" }).success).toBe(false);
    expect(updateKnowledgeItemBodySchema.safeParse({ projectId: "proj_x" }).success).toBe(false);
    expect(updateKnowledgeItemBodySchema.safeParse({ version: 2 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/entities.test.ts`
Expected: FAIL — cannot resolve `../../src/modules/knowledge-core/entities.js`.

- [ ] **Step 3: Add the three error classes**

Append to the end of `src/lib/errors.ts`:

```ts
export class KnowledgeNotFoundError extends AppError {
  constructor(message = "knowledge item not found") {
    super(message, 404, "KNOWLEDGE_NOT_FOUND");
  }
}

export class InvalidKnowledgeTypeError extends AppError {
  constructor(message = "knowledge type is not supported") {
    super(message, 422, "INVALID_KNOWLEDGE_TYPE");
  }
}

export class InvalidStatusTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(`invalid status transition: ${from} -> ${to}`, 422, "INVALID_STATUS_TRANSITION");
  }
}
```

- [ ] **Step 4: Create `src/modules/knowledge-core/entities.ts`**

```ts
import { ulid } from "ulid";
import { z } from "zod";

export const KNOWLEDGE_TYPES = [
  "Decision",
  "Concept",
  "Procedure",
  "Troubleshooting",
  "Investigation",
  "Architecture",
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const KNOWLEDGE_STATUSES = [
  "DISCOVERED",
  "PROPOSED",
  "VALIDATING",
  "ACCEPTED",
  "PUBLISHED",
  "UPDATED",
  "STALE",
  "DEPRECATED",
  "REJECTED",
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export interface KnowledgeItem {
  id: string;
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status: KnowledgeStatus;
  version: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const knowledgeIdSchema = z.string().regex(/^know_[0-9A-HJKMNP-TV-Z]{26}$/);

export const knowledgeTypeSchema = z.enum(KNOWLEDGE_TYPES);
export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);

const nonEmpty = z.string().trim().min(1);

export const createKnowledgeItemBodySchema = z
  .object({
    projectId: nonEmpty,
    type: knowledgeTypeSchema,
    title: nonEmpty,
    summary: nonEmpty,
    content: z.record(z.unknown()).default({}),
    status: knowledgeStatusSchema.optional(),
  })
  .strict();

export const updateKnowledgeItemBodySchema = z
  .object({
    title: nonEmpty.optional(),
    summary: nonEmpty.optional(),
    content: z.record(z.unknown()).optional(),
    status: knowledgeStatusSchema.optional(),
  })
  .strict();

export function newKnowledgeItemId(): string {
  return `know_${ulid()}`;
}
```

- [ ] **Step 5: Append the error-class tests and update the import line**

In `test/lib/errors.test.ts`, extend the existing import block so it also imports the new classes:

```ts
import {
  AppError,
  NotFoundError,
  ValidationError,
  KnowledgeNotFoundError,
  InvalidKnowledgeTypeError,
  InvalidStatusTransitionError,
} from "../../src/lib/errors.js";
```

Then append at the end of the file:

```ts
describe("knowledge errors", () => {
  it("KnowledgeNotFoundError maps to 404 / KNOWLEDGE_NOT_FOUND", () => {
    const e = new KnowledgeNotFoundError();
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("KNOWLEDGE_NOT_FOUND");
  });

  it("InvalidKnowledgeTypeError maps to 422 / INVALID_KNOWLEDGE_TYPE", () => {
    const e = new InvalidKnowledgeTypeError();
    expect(e.statusCode).toBe(422);
    expect(e.code).toBe("INVALID_KNOWLEDGE_TYPE");
  });

  it("InvalidStatusTransitionError maps to 422 and names the edge", () => {
    const e = new InvalidStatusTransitionError("PUBLISHED", "DISCOVERED");
    expect(e.statusCode).toBe(422);
    expect(e.code).toBe("INVALID_STATUS_TRANSITION");
    expect(e.message).toContain("PUBLISHED");
    expect(e.message).toContain("DISCOVERED");
  });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/modules/knowledge-core/entities.test.ts test/lib/errors.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/errors.ts src/modules/knowledge-core/entities.ts test/lib/errors.test.ts test/modules/knowledge-core/entities.test.ts
git commit -m "feat(pm-010): add KnowledgeItem model and knowledge error classes"
```

---

### Task 2: Lifecycle state machine

**Files:**
- Create: `src/modules/knowledge-core/lifecycle.ts`
- Test: `test/modules/knowledge-core/lifecycle.test.ts`

**Interfaces:**
- Consumes: `KnowledgeStatus`, `KNOWLEDGE_STATUSES` from Task 1; `InvalidStatusTransitionError` from Task 1.
- Produces:
  - `INITIAL_STATUSES: readonly ["DISCOVERED","PROPOSED"]`
  - `canTransition(from: KnowledgeStatus, to: KnowledgeStatus): boolean`
  - `assertTransition(from: KnowledgeStatus, to: KnowledgeStatus): void` (throws `422 INVALID_STATUS_TRANSITION`)
  - `isInitialStatus(status: KnowledgeStatus): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/modules/knowledge-core/lifecycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  INITIAL_STATUSES,
  assertTransition,
  canTransition,
  isInitialStatus,
} from "../../../src/modules/knowledge-core/lifecycle.js";
import { KNOWLEDGE_STATUSES, type KnowledgeStatus } from "../../../src/modules/knowledge-core/entities.js";

const LEGAL: Array<[KnowledgeStatus, KnowledgeStatus]> = [
  ["DISCOVERED", "PROPOSED"],
  ["PROPOSED", "VALIDATING"],
  ["VALIDATING", "REJECTED"],
  ["VALIDATING", "ACCEPTED"],
  ["ACCEPTED", "PUBLISHED"],
  ["PUBLISHED", "UPDATED"],
  ["PUBLISHED", "STALE"],
  ["PUBLISHED", "DEPRECATED"],
];

describe("canTransition", () => {
  it("allows every legal edge", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true);
    }
  });

  it("rejects representative illegal edges", () => {
    expect(canTransition("PUBLISHED", "DISCOVERED")).toBe(false);
    expect(canTransition("DISCOVERED", "PUBLISHED")).toBe(false);
    expect(canTransition("PROPOSED", "ACCEPTED")).toBe(false);
    expect(canTransition("REJECTED", "PROPOSED")).toBe(false);
  });

  it("has no self-edges", () => {
    for (const status of KNOWLEDGE_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
    }
  });

  it("treats REJECTED / UPDATED / STALE / DEPRECATED as terminal", () => {
    const terminal: KnowledgeStatus[] = ["REJECTED", "UPDATED", "STALE", "DEPRECATED"];
    for (const from of terminal) {
      for (const to of KNOWLEDGE_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });
});

describe("assertTransition", () => {
  it("throws 422 INVALID_STATUS_TRANSITION for an illegal edge", () => {
    try {
      assertTransition("PUBLISHED", "DISCOVERED");
      throw new Error("expected assertTransition to throw");
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(422);
      expect((err as { code?: string }).code).toBe("INVALID_STATUS_TRANSITION");
    }
  });

  it("does not throw for a legal edge", () => {
    expect(() => assertTransition("ACCEPTED", "PUBLISHED")).not.toThrow();
  });
});

describe("initial statuses", () => {
  it("is exactly DISCOVERED and PROPOSED", () => {
    expect([...INITIAL_STATUSES]).toEqual(["DISCOVERED", "PROPOSED"]);
    expect(isInitialStatus("DISCOVERED")).toBe(true);
    expect(isInitialStatus("PROPOSED")).toBe(true);
    expect(isInitialStatus("ACCEPTED")).toBe(false);
    expect(isInitialStatus("PUBLISHED")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/lifecycle.test.ts`
Expected: FAIL — cannot resolve `../../src/modules/knowledge-core/lifecycle.js`.

- [ ] **Step 3: Create `src/modules/knowledge-core/lifecycle.ts`**

```ts
import { InvalidStatusTransitionError } from "../../lib/errors.js";
import type { KnowledgeStatus } from "./entities.js";

/** Statuses a newly created item may carry. */
export const INITIAL_STATUSES = ["DISCOVERED", "PROPOSED"] as const;

/** The literal domain lifecycle graph; terminal states map to []. */
const TRANSITIONS: Record<KnowledgeStatus, readonly KnowledgeStatus[]> = {
  DISCOVERED: ["PROPOSED"],
  PROPOSED: ["VALIDATING"],
  VALIDATING: ["REJECTED", "ACCEPTED"],
  ACCEPTED: ["PUBLISHED"],
  PUBLISHED: ["UPDATED", "STALE", "DEPRECATED"],
  REJECTED: [],
  UPDATED: [],
  STALE: [],
  DEPRECATED: [],
};

export function canTransition(from: KnowledgeStatus, to: KnowledgeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: KnowledgeStatus, to: KnowledgeStatus): void {
  if (!canTransition(from, to)) throw new InvalidStatusTransitionError(from, to);
}

export function isInitialStatus(status: KnowledgeStatus): boolean {
  return (INITIAL_STATUSES as readonly KnowledgeStatus[]).includes(status);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/modules/knowledge-core/lifecycle.ts test/modules/knowledge-core/lifecycle.test.ts
git commit -m "feat(pm-010): add KnowledgeItem lifecycle state machine"
```

---

### Task 3: knowledge_items indexes

**Files:**
- Modify: `src/lib/indexes.ts:16-33` (per-collection extras for `knowledge_items`)
- Modify: `test/lib/indexes.test.ts` (append a `knowledge_items indexes` block)

**Interfaces:**
- Consumes: nothing (existing `IndexSpec`, `TENANCY_INDEX`, `CORE_COLLECTIONS`).
- Produces: `CORE_INDEXES` entry for `knowledge_items` now carrying `org_project`, `id_unique`, `project_type`, `project_status`. Shape of `CORE_INDEXES` / `ROOT_INDEXES` / `ensureIndexes` is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `test/lib/indexes.test.ts`:

```ts
describe("knowledge_items indexes", () => {
  it("declares unique id plus type and status lookups on top of tenancy", () => {
    const entry = CORE_INDEXES.find((c) => c.collection === "knowledge_items");
    expect(entry).toBeDefined();
    const names = entry!.indexes.map((i) => i.name);
    expect(names).toContain("org_project");
    expect(names).toContain("id_unique");
    expect(names).toContain("project_type");
    expect(names).toContain("project_status");

    expect(entry!.indexes.find((i) => i.name === "id_unique")!.unique).toBe(true);
    expect(entry!.indexes.find((i) => i.name === "project_type")!.key).toEqual({
      organizationId: 1, projectId: 1, type: 1,
    });
    expect(entry!.indexes.find((i) => i.name === "project_status")!.key).toEqual({
      organizationId: 1, projectId: 1, status: 1,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/lib/indexes.test.ts`
Expected: FAIL — `id_unique` / `project_type` / `project_status` missing.

- [ ] **Step 3: Add the per-collection extras**

In `src/lib/indexes.ts`, replace the block from `const CORE_COLLECTIONS = [` through the end of `CORE_INDEXES` (lines 16-33) with:

```ts
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

type CoreCollection = (typeof CORE_COLLECTIONS)[number];

/**
 * Specialized indexes appended after the shared tenancy index. PM-010 adds
 * knowledge-item identity and lookup indexes; later model tickets extend this
 * table for their own collection.
 */
const CORE_COLLECTION_EXTRA_INDEXES: Partial<Record<CoreCollection, readonly IndexSpec[]>> = {
  knowledge_items: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, type: 1 }, name: "project_type" },
    { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
  ],
};

export const CORE_INDEXES: ReadonlyArray<CollectionIndexes> = CORE_COLLECTIONS.map(
  (collection) => ({
    collection,
    indexes: [TENANCY_INDEX, ...(CORE_COLLECTION_EXTRA_INDEXES[collection] ?? [])],
  }),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/lib/indexes.test.ts`
Expected: PASS (the pre-existing `CORE_INDEXES` / `ensureIndexes` / `ROOT_INDEXES` cases still pass).

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/lib/indexes.ts test/lib/indexes.test.ts
git commit -m "feat(pm-010): add knowledge_items indexes"
```

---

### Task 4: Tenant-scoped repository and test fake

**Files:**
- Create: `test/support/fake-db.ts`
- Create: `src/modules/knowledge-core/repository.ts`
- Test: `test/modules/knowledge-core/repository.test.ts`

**Interfaces:**
- Consumes: `KnowledgeItem`, `KnowledgeType`, `KnowledgeStatus`, `newKnowledgeItemId` from Task 1.
- Produces:
  - `createFakeDb(seed?: Record<string, Row[]>): { db: Db; rows: Record<string, Row[]> }` (test support; used by Tasks 5 and 6)
  - `createKnowledgeItemStore(db: Db): KnowledgeItemStore`
  - `interface CreateKnowledgeItemInput { organizationId; projectId; type; title; summary; content; status; ownerId }`
  - `interface KnowledgeItemFilter { projectId?; type?; status? }`
  - `interface UpdateKnowledgeItemPatch { title?; summary?; content?; status? }`
  - `KnowledgeItemStore` methods: `create`, `findById(organizationId, id)`, `findByProject(organizationId, filter)`, `update(organizationId, id, patch)`, `delete(organizationId, id)`

- [ ] **Step 1: Write the test fake and the failing repository test**

Create `test/support/fake-db.ts`:

```ts
import type { Db } from "mongodb";

export type Row = Record<string, unknown>;
export type Collections = Record<string, Row[]>;

export interface FakeDb {
  db: Db;
  rows: Collections;
}

/** Exact-equality match only: every filter the knowledge code issues is flat. */
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

export function createFakeDb(seed: Collections = {}): FakeDb {
  const rows: Collections = Object.fromEntries(
    Object.entries(seed).map(([name, list]) => [name, [...list]]),
  );

  const db = {
    collection: (name: string) => {
      const list = (rows[name] ??= []);
      return {
        insertOne: async (doc: Row) => {
          list.push(doc);
          return {};
        },
        findOne: async (filter: Row) => list.find((r) => matches(r, filter)) ?? null,
        find: (filter: Row) => ({
          toArray: async () => list.filter((r) => matches(r, filter)),
        }),
        findOneAndUpdate: async (filter: Row, update: { $set: Row }) => {
          const row = list.find((r) => matches(r, filter));
          if (!row) return null;
          Object.assign(row, update.$set);
          return { ...row };
        },
        deleteOne: async (filter: Row) => {
          const index = list.findIndex((r) => matches(r, filter));
          if (index === -1) return { deletedCount: 0 };
          list.splice(index, 1);
          return { deletedCount: 1 };
        },
      };
    },
  } as unknown as Db;

  return { db, rows };
}
```

Create `test/modules/knowledge-core/repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createKnowledgeItemStore } from "../../../src/modules/knowledge-core/repository.js";
import { createFakeDb } from "../../support/fake-db.js";

const org = "org_A";
const otherOrg = "org_B";
const project = "proj_1";
const otherProject = "proj_2";

const input = {
  organizationId: org,
  projectId: project,
  type: "Decision" as const,
  title: "Use AuditLog v2",
  summary: "Matter History uses the standardized audit schema.",
  content: {},
  status: "DISCOVERED" as const,
  ownerId: "tok_1",
};

describe("createKnowledgeItemStore.create", () => {
  it("stamps id, version, timestamps and returns the item", async () => {
    const { db } = createFakeDb();
    const item = await createKnowledgeItemStore(db).create(input);
    expect(item.id).toMatch(/^know_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(item.organizationId).toBe(org);
    expect(item.projectId).toBe(project);
    expect(item.status).toBe("DISCOVERED");
    expect(item.version).toBe(1);
    expect(item.ownerId).toBe("tok_1");
    expect(item.lastVerifiedAt).toBeNull();
  });
});

describe("createKnowledgeItemStore reads", () => {
  it("findById is organization-scoped", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeItemStore(db);
    const created = await store.create(input);
    expect(await store.findById(org, created.id)).toEqual(created);
    expect(await store.findById(otherOrg, created.id)).toBeNull();
  });

  it("findByProject filters by project, type and status without crossing orgs", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeItemStore(db);
    await store.create(input);
    await store.create({ ...input, projectId: otherProject, type: "Concept", status: "PROPOSED" });

    expect((await store.findByProject(org, { projectId: project })).length).toBe(1);
    expect((await store.findByProject(org, { type: "Concept" })).length).toBe(1);
    expect((await store.findByProject(org, { status: "PROPOSED" })).length).toBe(1);
    expect((await store.findByProject(org, {})).length).toBe(2);
    expect((await store.findByProject(otherOrg, {})).length).toBe(0);
  });
});

describe("createKnowledgeItemStore writes", () => {
  it("updates an in-org item and refuses a foreign one", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeItemStore(db);
    const created = await store.create(input);

    const updated = await store.update(org, created.id, { title: "New title" });
    expect(updated?.title).toBe("New title");
    expect(updated?.id).toBe(created.id);
    expect(updated?.updatedAt).not.toBe("");

    expect(await store.update(otherOrg, created.id, { title: "Evil" })).toBeNull();
  });

  it("deletes only an in-org item and reports whether it removed one", async () => {
    const { db, rows } = createFakeDb();
    const store = createKnowledgeItemStore(db);
    const created = await store.create(input);

    expect(await store.delete(otherOrg, created.id)).toBe(false);
    expect(rows.knowledge_items).toHaveLength(1);

    expect(await store.delete(org, created.id)).toBe(true);
    expect(rows.knowledge_items).toHaveLength(0);
    expect(await store.findById(org, created.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/repository.test.ts`
Expected: FAIL — cannot resolve `../../src/modules/knowledge-core/repository.js`.

- [ ] **Step 3: Create `src/modules/knowledge-core/repository.ts`**

```ts
import type { Db } from "mongodb";
import {
  newKnowledgeItemId,
  type KnowledgeItem,
  type KnowledgeStatus,
  type KnowledgeType,
} from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateKnowledgeItemInput {
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status: KnowledgeStatus;
  ownerId: string;
}

export interface KnowledgeItemFilter {
  projectId?: string;
  type?: KnowledgeType;
  status?: KnowledgeStatus;
}

export interface UpdateKnowledgeItemPatch {
  title?: string;
  summary?: string;
  content?: Record<string, unknown>;
  status?: KnowledgeStatus;
}

export interface KnowledgeItemStore {
  create(input: CreateKnowledgeItemInput): Promise<KnowledgeItem>;
  findById(organizationId: string, id: string): Promise<KnowledgeItem | null>;
  findByProject(
    organizationId: string,
    filter: KnowledgeItemFilter,
  ): Promise<KnowledgeItem[]>;
  update(
    organizationId: string,
    id: string,
    patch: UpdateKnowledgeItemPatch,
  ): Promise<KnowledgeItem | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

export function createKnowledgeItemStore(db: Db): KnowledgeItemStore {
  const col = () => db.collection<KnowledgeItem>("knowledge_items");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const item: KnowledgeItem = {
        id: newKnowledgeItemId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        summary: input.summary,
        content: input.content,
        status: input.status,
        version: 1,
        ownerId: input.ownerId,
        createdAt: now,
        updatedAt: now,
        lastVerifiedAt: null,
      };
      await col().insertOne(item);
      return item;
    },

    async findById(organizationId, id) {
      return col().findOne({ id, organizationId }, READ_OPTS) as Promise<KnowledgeItem | null>;
    },

    async findByProject(organizationId, filter) {
      const query: Record<string, unknown> = { organizationId };
      if (filter.projectId !== undefined) query.projectId = filter.projectId;
      if (filter.type !== undefined) query.type = filter.type;
      if (filter.status !== undefined) query.status = filter.status;
      return col().find(query, READ_OPTS).toArray() as Promise<KnowledgeItem[]>;
    },

    async update(organizationId, id, patch) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { ...patch, updatedAt: new Date().toISOString() } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as KnowledgeItem | null;
    },

    async delete(organizationId, id) {
      const result = await col().deleteOne({ id, organizationId });
      return result.deletedCount > 0;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/knowledge-core/repository.ts test/support/fake-db.ts test/modules/knowledge-core/repository.test.ts
git commit -m "feat(pm-010): add tenant-scoped knowledge item repository"
```

---

### Task 5: Knowledge CRUD routes

**Files:**
- Create: `src/routes/knowledge.ts`
- Modify: `src/app.ts` (import + register)
- Test: `test/routes/knowledge.test.ts`

**Interfaces:**
- Consumes: `createKnowledgeItemBodySchema`, `updateKnowledgeItemBodySchema`, `knowledgeIdSchema`, `knowledgeTypeSchema`, `knowledgeStatusSchema` (Task 1); `assertTransition`, `isInitialStatus` (Task 2); `createKnowledgeItemStore`, `KnowledgeItemFilter` (Task 4); `projectIdSchema` from `src/modules/project-context/entities.js`; error classes from Task 1 plus existing `InvalidTenantScopeError`, `TenantNotFoundError`, `UnauthorizedError`, `ValidationError`.
- Produces: `registerKnowledgeRoutes(app: FastifyInstance): void`, registered in `buildApp`.
- Routes: `POST /knowledge`, `GET /knowledge/:id`, `GET /knowledge`, `PATCH /knowledge/:id`, `DELETE /knowledge/:id`.

- [ ] **Step 1: Write the failing route test**

Create `test/routes/knowledge.test.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newKnowledgeItemId } from "../../src/modules/knowledge-core/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = "proj_1";
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

function buildApp(rows: Collections, withContext = true): FastifyInstance {
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const enriched = req as unknown as { actor: unknown; projectContext: unknown };
    enriched.actor = { actorId: "tok_1", organizationId: orgId, type: "service" };
    if (withContext) enriched.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerKnowledgeRoutes(app);
  return app;
}

const seeded = (extra: Collections = {}): Collections => ({ projects: [project], knowledge_items: [], ...extra });

describe("POST /knowledge", () => {
  it("creates a 201 item with defaults and server-derived owner", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^know_/);
    expect(body.status).toBe("DISCOVERED");
    expect(body.content).toEqual({});
    expect(body.ownerId).toBe("tok_1");
    expect(body.organizationId).toBe(orgId);
    await app.close();
  });

  it("accepts PROPOSED as an explicit initial status", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s", status: "PROPOSED" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("PROPOSED");
    await app.close();
  });

  it("rejects an unknown type with 422", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Fact", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_KNOWLEDGE_TYPE");
    await app.close();
  });

  it("rejects a non-initial status with 422", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s", status: "ACCEPTED" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_STATUS_TRANSITION");
    await app.close();
  });

  it("rejects a missing projectId with 400", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("returns 404 for a project outside the org", async () => {
    const app = buildApp({ projects: [], knowledge_items: [] });
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TENANT_NOT_FOUND");
    await app.close();
  });

  it("returns 400 when there is no organization context", async () => {
    const app = buildApp(seeded(), false);
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TENANT_SCOPE");
    await app.close();
  });
});

describe("GET /knowledge/:id", () => {
  it("returns an in-org item, 404 for missing, 400 for a malformed id", async () => {
    const item = {
      id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
      title: "t", summary: "s", content: {}, status: "DISCOVERED", version: 1,
      ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
    };
    const app = buildApp({ projects: [project], knowledge_items: [item] });

    const ok = await app.inject({ method: "GET", url: `/knowledge/${item.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toBe(item.id);

    const missing = await app.inject({ method: "GET", url: `/knowledge/${newKnowledgeItemId()}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");

    const malformed = await app.inject({ method: "GET", url: "/knowledge/not-an-id" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
});

describe("GET /knowledge", () => {
  it("lists with project, type and status filters", async () => {
    const make = (over: Record<string, unknown>) => ({
      id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
      title: "t", summary: "s", content: {}, status: "DISCOVERED", version: 1,
      ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null, ...over,
    });
    const app = buildApp({
      projects: [project],
      knowledge_items: [make({}), make({ type: "Concept", status: "PROPOSED" })],
    });

    const all = await app.inject({ method: "GET", url: `/knowledge?projectId=${projectId}` });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(2);

    const concept = await app.inject({ method: "GET", url: "/knowledge?type=Concept" });
    expect(concept.json().items).toHaveLength(1);

    const proposed = await app.inject({ method: "GET", url: "/knowledge?status=PROPOSED" });
    expect(proposed.json().items).toHaveLength(1);

    const badType = await app.inject({ method: "GET", url: "/knowledge?type=Fact" });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().error.code).toBe("VALIDATION_ERROR");

    const unknownProject = await app.inject({ method: "GET", url: "/knowledge?projectId=proj_missing" });
    expect(unknownProject.statusCode).toBe(404);
    expect(unknownProject.json().error.code).toBe("TENANT_NOT_FOUND");
    await app.close();
  });
});

describe("PATCH /knowledge/:id", () => {
  const published = {
    id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
    title: "t", summary: "s", content: {}, status: "PUBLISHED", version: 1,
    ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
  };

  it("updates a field and returns the item", async () => {
    const item = { ...published, status: "DISCOVERED" };
    const app = buildApp({ projects: [project], knowledge_items: [item] });
    const res = await app.inject({
      method: "PATCH", url: `/knowledge/${item.id}`, payload: { title: "New" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("New");
    await app.close();
  });

  it("applies a legal status transition and rejects an illegal one", async () => {
    const app = buildApp({ projects: [project], knowledge_items: [{ ...published, status: "PROPOSED" }] });
    const id = published.id;

    const legal = await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { status: "VALIDATING" } });
    expect(legal.statusCode).toBe(200);
    expect(legal.json().status).toBe("VALIDATING");

    const illegal = await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { status: "DISCOVERED" } });
    expect(illegal.statusCode).toBe(422);
    expect(illegal.json().error.code).toBe("INVALID_STATUS_TRANSITION");
    await app.close();
  });

  it("rejects an empty patch and immutable fields with 400", async () => {
    const app = buildApp({ projects: [project], knowledge_items: [{ ...published, status: "DISCOVERED" }] });
    const id = published.id;

    const empty = await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: {} });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("VALIDATION_ERROR");

    const immutable = await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { type: "Concept" } });
    expect(immutable.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 for a missing item", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "PATCH", url: `/knowledge/${newKnowledgeItemId()}`, payload: { title: "x" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");
    await app.close();
  });
});

describe("DELETE /knowledge/:id", () => {
  it("deletes an in-org item and 404s for a missing one", async () => {
    const item = {
      id: newKnowledgeItemId(), organizationId: orgId, projectId, type: "Decision",
      title: "t", summary: "s", content: {}, status: "DISCOVERED", version: 1,
      ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
    };
    const app = buildApp({ projects: [project], knowledge_items: [item] });

    const gone = await app.inject({ method: "DELETE", url: `/knowledge/${item.id}` });
    expect(gone.statusCode).toBe(204);

    const again = await app.inject({ method: "DELETE", url: `/knowledge/${item.id}` });
    expect(again.statusCode).toBe(404);
    expect(again.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");
    await app.close();
  });

  it("cannot delete an item in another organization", async () => {
    const foreign = {
      id: newKnowledgeItemId(), organizationId: "org_B", projectId, type: "Decision",
      title: "t", summary: "s", content: {}, status: "DISCOVERED", version: 1,
      ownerId: "tok_1", createdAt: "", updatedAt: "", lastVerifiedAt: null,
    };
    const app = buildApp({ projects: [project], knowledge_items: [foreign] });
    const res = await app.inject({ method: "DELETE", url: `/knowledge/${foreign.id}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/routes/knowledge.test.ts`
Expected: FAIL — cannot resolve `../../src/routes/knowledge.js`.

- [ ] **Step 3: Create `src/routes/knowledge.ts`**

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import type { ProjectContext } from "../modules/project-context/context.js";
import {
  createKnowledgeItemBodySchema,
  knowledgeIdSchema,
  knowledgeStatusSchema,
  knowledgeTypeSchema,
  updateKnowledgeItemBodySchema,
} from "../modules/knowledge-core/entities.js";
import {
  createKnowledgeItemStore,
  type KnowledgeItemFilter,
} from "../modules/knowledge-core/repository.js";
import { assertTransition, isInitialStatus } from "../modules/knowledge-core/lifecycle.js";
import {
  InvalidKnowledgeTypeError,
  InvalidStatusTransitionError,
  InvalidTenantScopeError,
  KnowledgeNotFoundError,
  TenantNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  return ctx;
}

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(message);
  return result.data as T;
}

export function registerKnowledgeRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createKnowledgeItemStore(app.db);

  async function requireProject(organizationId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(organizationId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/knowledge", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);

    const raw = (req.body ?? {}) as { type?: unknown; status?: unknown };

    if (!knowledgeTypeSchema.safeParse(raw.type).success) {
      throw new InvalidKnowledgeTypeError();
    }
    if (raw.status !== undefined) {
      const status = knowledgeStatusSchema.safeParse(raw.status);
      if (!status.success || !isInitialStatus(status.data)) {
        throw new InvalidStatusTransitionError("none", String(raw.status));
      }
    }

    const parsed = createKnowledgeItemBodySchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError("invalid knowledge item body");
    const body = parsed.data;

    if (!projectIdSchema.safeParse(body.projectId).success) {
      throw new ValidationError("projectId is malformed");
    }

    await requireProject(ctx.organizationId, body.projectId);

    const item = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      type: body.type,
      title: body.title,
      summary: body.summary,
      content: body.content,
      status: body.status ?? "DISCOVERED",
      ownerId: actor.actorId,
    });
    reply.status(201);
    return item;
  });

  app.get("/knowledge/:id", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();
    return item;
  });

  app.get("/knowledge", BEARER, async (req) => {
    const ctx = context(req);
    const query = req.query as { projectId?: string; type?: string; status?: string };
    const filter: KnowledgeItemFilter = {};

    if (query.projectId !== undefined) {
      const projectId = parseOrThrow(projectIdSchema, query.projectId, "projectId is malformed");
      await requireProject(ctx.organizationId, projectId);
      filter.projectId = projectId;
    }
    if (query.type !== undefined) {
      filter.type = parseOrThrow(knowledgeTypeSchema, query.type, "type filter is invalid");
    }
    if (query.status !== undefined) {
      filter.status = parseOrThrow(knowledgeStatusSchema, query.status, "status filter is invalid");
    }

    return { items: await store().findByProject(ctx.organizationId, filter) };
  });

  app.patch("/knowledge/:id", BEARER, async (req) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const parsed = updateKnowledgeItemBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("invalid knowledge item patch");
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("patch must contain at least one field");
    }

    const existing = await store().findById(ctx.organizationId, id);
    if (!existing) throw new KnowledgeNotFoundError();

    if (patch.status !== undefined && patch.status !== existing.status) {
      assertTransition(existing.status, patch.status);
    }

    const updated = await store().update(ctx.organizationId, id, patch);
    if (!updated) throw new KnowledgeNotFoundError();
    return updated;
  });

  app.delete("/knowledge/:id", BEARER, async (req, reply) => {
    const ctx = context(req);
    const { id } = req.params as { id: string };
    parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

    const removed = await store().delete(ctx.organizationId, id);
    if (!removed) throw new KnowledgeNotFoundError();
    reply.status(204);
    return null;
  });
}
```

- [ ] **Step 4: Register the routes in `src/app.ts`**

Add the import beside the other route imports:

```ts
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
```

Add the registration call after `registerRepositoryRoutes(app);`:

```ts
  registerKnowledgeRoutes(app);
```

- [ ] **Step 5: Run the route tests to verify they pass**

Run: `npx vitest run test/routes/knowledge.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npm run typecheck && npm run lint
git add src/routes/knowledge.ts src/app.ts test/routes/knowledge.test.ts
git commit -m "feat(pm-010): add knowledge item CRUD routes"
```

---

### Task 6: End-to-end coverage and README

**Files:**
- Create: `test/routes/knowledge-e2e.test.ts`
- Modify: `src/modules/knowledge-core/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-5, `buildApp` from `src/app.ts`, `createFakeDb` from Task 4, `hashSecret` from `src/modules/auth/secret.js`.
- Produces: end-to-end coverage of the full knowledge lifecycle through the real plugin stack; updated module README.

- [ ] **Step 1: Write the e2e test**

Create `test/routes/knowledge-e2e.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/index.js";
import { newOrgId, newProjectId } from "../../src/modules/project-context/entities.js";
import { hashSecret } from "../../src/modules/auth/secret.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = newOrgId();
const otherOrgId = newOrgId();
const projectId = newProjectId();

const config = {
  port: 0, host: "0.0.0.0", nodeEnv: "test", logLevel: "silent",
  mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "admin-secret", authTokenPepper: "pepper",
} as AppConfig;

function seed(): Collections {
  return {
    service_tokens: [{
      id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x",
      hashedSecret: hashSecret("pmk_any", "pepper"), createdAt: "", revokedAt: null,
    }],
    organizations: [{ id: orgId, name: "a", createdAt: "", updatedAt: "" }],
    projects: [{ id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" }],
    knowledge_items: [],
  };
}

describe("knowledge end-to-end", () => {
  it("rejects a request scoped to another organization with 403", async () => {
    const { db } = createFakeDb(seed());
    const app = buildApp({ config, db });
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      headers: { authorization: "Bearer pmk_any", "x-organization-id": otherOrgId },
      payload: { projectId, type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });

  it("runs create → get → list → patch → delete within the caller's org", async () => {
    const { db } = createFakeDb(seed());
    const app = buildApp({ config, db });
    const headers = { authorization: "Bearer pmk_any", "x-organization-id": orgId };

    const created = await app.inject({
      method: "POST", url: "/knowledge", headers,
      payload: { projectId, type: "Decision", title: "Use AuditLog v2", summary: "Standardized audit schema." },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json().status).toBe("DISCOVERED");

    const fetched = await app.inject({ method: "GET", url: `/knowledge/${id}`, headers });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().id).toBe(id);

    const listed = await app.inject({
      method: "GET", url: `/knowledge?projectId=${projectId}&type=Decision`, headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);

    const proposed = await app.inject({
      method: "PATCH", url: `/knowledge/${id}`, headers, payload: { status: "PROPOSED" },
    });
    expect(proposed.statusCode).toBe(200);
    expect(proposed.json().status).toBe("PROPOSED");

    const illegal = await app.inject({
      method: "PATCH", url: `/knowledge/${id}`, headers, payload: { status: "PUBLISHED" },
    });
    expect(illegal.statusCode).toBe(422);
    expect(illegal.json().error.code).toBe("INVALID_STATUS_TRANSITION");

    const removed = await app.inject({ method: "DELETE", url: `/knowledge/${id}`, headers });
    expect(removed.statusCode).toBe(204);

    const afterDelete = await app.inject({ method: "GET", url: `/knowledge/${id}`, headers });
    expect(afterDelete.statusCode).toBe(404);
    expect(afterDelete.json().error.code).toBe("KNOWLEDGE_NOT_FOUND");

    await app.close();
  });

  it("returns 400 when the organization header is omitted", async () => {
    const { db } = createFakeDb(seed());
    const app = buildApp({ config, db });
    const res = await app.inject({
      method: "POST", url: "/knowledge",
      headers: { authorization: "Bearer pmk_any" },
      payload: { projectId, type: "Decision", title: "t", summary: "s" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_TENANT_SCOPE");
    await app.close();
  });
});
```

- [ ] **Step 2: Run it to verify it passes against the implementation**

Run: `npx vitest run test/routes/knowledge-e2e.test.ts`
Expected: PASS. If the 403 case fails, confirm `registerTenantContext` is registered before the knowledge routes in `buildApp` (it is, via the existing plugin order).

- [ ] **Step 3: Update `src/modules/knowledge-core/README.md`**

Replace the file contents with:

```markdown
# Knowledge Core

Canonical knowledge items, facts, relations, versions, provenance, and audit.

**Status:** The `KnowledgeItem` model, lifecycle state machine, tenant-scoped
repository, and CRUD routes landed in PM-010. Facts (PM-014), relations
(PM-015), versioning (PM-012), provenance (PM-013), and audit (PM-016) are
still to come.
```

- [ ] **Step 4: Run the whole suite, typecheck and lint**

```bash
npm run check
```

Expected: lint, typecheck, and all tests pass (including the pre-existing PM-001..PM-005 suites).

- [ ] **Step 5: Commit**

```bash
git add test/routes/knowledge-e2e.test.ts src/modules/knowledge-core/README.md
git commit -m "test(pm-010): add knowledge end-to-end coverage and update README"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §1 Architecture / units | Tasks 1, 2, 4, 5 |
| §2 Data model (fields, defaults, immutability) | Tasks 1, 4 |
| §2 Indexes | Task 3 |
| §3 Lifecycle state machine | Task 2 |
| §4 Repository (incl. org scoping) | Task 4 |
| §5 API surface (5 routes, scope, validation) | Task 5 |
| §6 Error handling | Tasks 1, 5 |
| §7 Configuration (none) | — (no change, as specified) |
| §8 Isolation guarantees | Tasks 4 (repo scoping), 5 (route scoping), 6 (cross-org 403) |
| §9 Testing | Every task's test steps + Task 6 e2e |
| §10 Files | Tasks 1-6 |
| Initial-status rule (DISCOVERED default / PROPOSED only) | Tasks 1 (schema), 2 (initial set), 5 (route) |
| Content opaque (PM-011 seam) | Task 1 (`z.record(z.unknown())`), Task 4 (stored verbatim) |
| Version fixed at 1 (PM-012) | Task 4 |

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N" — every code and test step is literal.

**Type consistency:** `KnowledgeStatus`/`KnowledgeType`/`KnowledgeItem` (Task 1) are used with those exact names in Tasks 2, 4, 5. `createKnowledgeItemStore`/`KnowledgeItemFilter` (Task 4) match Task 5's imports. `createFakeDb`/`Collections` (Task 4) match Tasks 5 and 6. `assertTransition`/`isInitialStatus`/`INITIAL_STATUSES` (Task 2) match Task 5. `InvalidStatusTransitionError(from, to)` signature matches Task 1.
