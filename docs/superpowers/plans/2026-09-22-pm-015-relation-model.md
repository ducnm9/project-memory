# PM-015 Relation Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Relation` as a first-class knowledge graph edge (subject–predicate–object triple) with a fixed predicate vocabulary, reviewer stamping, compact lifecycle, versioning, and source attach/detach.

**Architecture:** Relation is a subsystem parallel to Fact, in `src/modules/knowledge-core`. It mirrors the Fact model (entity, lifecycle, repository, dedicated version store, routes) with two differences: `predicate` is a closed enum (`RELATION_PREDICATES`) enforced at the schema boundary, and `reviewerId` is auto-stamped from the authenticated actor on the `PROPOSED → ACCEPTED|REJECTED` transition. Subject/object are free-form strings (no referential integrity).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Fastify 5, MongoDB 7 driver, Zod 3, ULID, Vitest. In-memory `fake-db` test support for repository/route tests.

**Spec:** `docs/superpowers/specs/2026-09-22-pm-015-relation-model-design.md`

## Global Constraints

- Node `>=20.19.0`; ESM modules — **all relative imports use the `.js` extension** even for `.ts` files.
- No new dependencies. Use only `fastify`, `mongodb`, `ulid`, `zod` (already present).
- IDs are `<prefix>_` + ULID; ID regex uses Crockford base32 (no I, L, O, U): `/^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$/`.
- All Zod body schemas are `.strict()`.
- Read projections strip `_id`: `{ projection: { _id: 0 } }`.
- Repository writes bump `version` via `$inc: { version: 1 }` and set `updatedAt`.
- Route auth marker: `const BEARER = { config: { auth: "bearer" as const } };`.
- Tests: `npm run test` (vitest). Run a single file with `npx vitest run <path>`.
- Verify a full task with `npm run check` (lint + typecheck + test) before the final commit of a task if convenient; otherwise `npx vitest run <path>`.
- `RELATION_PREDICATES` (verbatim, order matters for tests): `depends_on`, `implemented_by`, `defined_by`, `related_to`, `supersedes`, `contradicts`, `derived_from`, `documents`, `fixes`, `impacts`, `owned_by`.
- `RELATION_STATUSES` (verbatim): `PROPOSED`, `ACCEPTED`, `REJECTED`, `DEPRECATED`.

---

### Task 1: Relation entity + schemas

**Files:**
- Create: `src/modules/knowledge-core/relation-entities.ts`
- Test: `test/modules/knowledge-core/relation-entities.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `RELATION_PREDICATES: readonly [...]`, `type RelationPredicate`
  - `RELATION_STATUSES: readonly [...]`, `type RelationStatus`
  - `interface Relation { id, organizationId, projectId, subjectId, predicate: RelationPredicate, objectId, status: RelationStatus, version: number, ownerId, reviewerId: string | null, sourceIds: string[], createdAt, updatedAt, lastVerifiedAt: string | null }`
  - `relationIdSchema: ZodString`, `relationPredicateSchema: ZodEnum`, `relationStatusSchema: ZodEnum`
  - `createRelationBodySchema` (strict: `{ projectId, subjectId, predicate, objectId }`)
  - `updateRelationBodySchema` (strict: `{ subjectId?, predicate?, objectId?, status?, changeSummary? }`)
  - `newRelationId(): string` → `"rel_" + ulid()`

- [ ] **Step 1: Write the failing test**

```ts
// test/modules/knowledge-core/relation-entities.test.ts
import { describe, expect, it } from "vitest";
import {
  RELATION_PREDICATES,
  createRelationBodySchema,
  updateRelationBodySchema,
  relationIdSchema,
  newRelationId,
} from "../../../src/modules/knowledge-core/relation-entities.js";

describe("relation-entities", () => {
  const valid = { projectId: "prj_x", subjectId: "a", predicate: "depends_on", objectId: "b" };

  it("has the 11 domain predicates in order", () => {
    expect(RELATION_PREDICATES).toEqual([
      "depends_on", "implemented_by", "defined_by", "related_to",
      "supersedes", "contradicts", "derived_from", "documents",
      "fixes", "impacts", "owned_by",
    ]);
  });

  it("accepts a valid create body", () => {
    expect(createRelationBodySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an off-vocabulary predicate", () => {
    expect(createRelationBodySchema.safeParse({ ...valid, predicate: "causes" }).success).toBe(false);
  });

  it("rejects a status supplied at creation (strict)", () => {
    expect(createRelationBodySchema.safeParse({ ...valid, status: "ACCEPTED" }).success).toBe(false);
  });

  it("rejects a reviewerId in the patch body (strict)", () => {
    expect(updateRelationBodySchema.safeParse({ reviewerId: "tok_1" }).success).toBe(false);
  });

  it("accepts a status-only patch", () => {
    expect(updateRelationBodySchema.safeParse({ status: "ACCEPTED" }).success).toBe(true);
  });

  it("mints ids matching the id schema", () => {
    expect(relationIdSchema.safeParse(newRelationId()).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/relation-entities.test.ts`
Expected: FAIL — cannot find module `relation-entities.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/knowledge-core/relation-entities.ts
import { ulid } from "ulid";
import { z } from "zod";

export const RELATION_PREDICATES = [
  "depends_on", "implemented_by", "defined_by", "related_to",
  "supersedes", "contradicts", "derived_from", "documents",
  "fixes", "impacts", "owned_by",
] as const;
export type RelationPredicate = (typeof RELATION_PREDICATES)[number];

export const RELATION_STATUSES = ["PROPOSED", "ACCEPTED", "REJECTED", "DEPRECATED"] as const;
export type RelationStatus = (typeof RELATION_STATUSES)[number];

export interface Relation {
  id: string;
  organizationId: string;
  projectId: string;
  subjectId: string;
  predicate: RelationPredicate;
  objectId: string;
  status: RelationStatus;
  version: number;
  ownerId: string;
  reviewerId: string | null;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const relationIdSchema = z.string().regex(/^rel_[0-9A-HJKMNP-TV-Z]{26}$/);
export const relationPredicateSchema = z.enum(RELATION_PREDICATES);
export const relationStatusSchema = z.enum(RELATION_STATUSES);

const nonEmpty = z.string().trim().min(1);

export const createRelationBodySchema = z
  .object({
    projectId: nonEmpty,
    subjectId: nonEmpty,
    predicate: relationPredicateSchema,
    objectId: nonEmpty,
  })
  .strict();

export const updateRelationBodySchema = z
  .object({
    subjectId: nonEmpty.optional(),
    predicate: relationPredicateSchema.optional(),
    objectId: nonEmpty.optional(),
    status: relationStatusSchema.optional(),
    changeSummary: z.string().trim().min(1).optional(),
  })
  .strict();

export function newRelationId(): string {
  return `rel_${ulid()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/relation-entities.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/relation-entities.ts test/modules/knowledge-core/relation-entities.test.ts
git commit -m "feat: add Relation entity and schemas (PM-015)"
```

---

### Task 2: Relation lifecycle

**Files:**
- Create: `src/modules/knowledge-core/relation-lifecycle.ts`
- Test: `test/modules/knowledge-core/relation-lifecycle.test.ts`

**Interfaces:**
- Consumes: `RelationStatus` from `relation-entities.js`; `InvalidStatusTransitionError` from `../../lib/errors.js`.
- Produces:
  - `INITIAL_RELATION_STATUS: RelationStatus` (= `"PROPOSED"`)
  - `canRelationTransition(from: RelationStatus, to: RelationStatus): boolean`
  - `assertRelationTransition(from: RelationStatus, to: RelationStatus): void`

- [ ] **Step 1: Write the failing test**

```ts
// test/modules/knowledge-core/relation-lifecycle.test.ts
import { describe, expect, it } from "vitest";
import {
  INITIAL_RELATION_STATUS,
  canRelationTransition,
  assertRelationTransition,
} from "../../../src/modules/knowledge-core/relation-lifecycle.js";
import { InvalidStatusTransitionError } from "../../../src/lib/errors.js";

describe("relation-lifecycle", () => {
  it("starts at PROPOSED", () => {
    expect(INITIAL_RELATION_STATUS).toBe("PROPOSED");
  });

  it("allows PROPOSED -> ACCEPTED and PROPOSED -> REJECTED", () => {
    expect(canRelationTransition("PROPOSED", "ACCEPTED")).toBe(true);
    expect(canRelationTransition("PROPOSED", "REJECTED")).toBe(true);
  });

  it("allows ACCEPTED -> DEPRECATED", () => {
    expect(canRelationTransition("ACCEPTED", "DEPRECATED")).toBe(true);
  });

  it("treats REJECTED and DEPRECATED as terminal", () => {
    expect(canRelationTransition("REJECTED", "ACCEPTED")).toBe(false);
    expect(canRelationTransition("DEPRECATED", "ACCEPTED")).toBe(false);
  });

  it("throws on an illegal transition", () => {
    expect(() => assertRelationTransition("PROPOSED", "DEPRECATED")).toThrow(InvalidStatusTransitionError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/relation-lifecycle.test.ts`
Expected: FAIL — cannot find module `relation-lifecycle.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/knowledge-core/relation-lifecycle.ts
import { InvalidStatusTransitionError } from "../../lib/errors.js";
import type { RelationStatus } from "./relation-entities.js";

/** Status a newly created relation carries. */
export const INITIAL_RELATION_STATUS: RelationStatus = "PROPOSED";

/** The relation lifecycle graph; terminal states map to []. */
const TRANSITIONS: Record<RelationStatus, readonly RelationStatus[]> = {
  PROPOSED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["DEPRECATED"],
  REJECTED: [],
  DEPRECATED: [],
};

export function canRelationTransition(from: RelationStatus, to: RelationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertRelationTransition(from: RelationStatus, to: RelationStatus): void {
  if (!canRelationTransition(from, to)) throw new InvalidStatusTransitionError(from, to);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/relation-lifecycle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/relation-lifecycle.ts test/modules/knowledge-core/relation-lifecycle.test.ts
git commit -m "feat: add Relation lifecycle (PM-015)"
```

---

### Task 3: Relation repository

**Files:**
- Create: `src/modules/knowledge-core/relation-repository.ts`
- Test: `test/modules/knowledge-core/relation-repository.test.ts`

**Interfaces:**
- Consumes: `newRelationId`, `Relation`, `RelationPredicate`, `RelationStatus` from `relation-entities.js`; `Db` from `mongodb`.
- Produces:
  - `interface CreateRelationInput { organizationId, projectId, subjectId, predicate: RelationPredicate, objectId, status: RelationStatus, ownerId }`
  - `interface RelationFilter { projectId?, predicate?: RelationPredicate, status?: RelationStatus }`
  - `interface UpdateRelationPatch { subjectId?, predicate?: RelationPredicate, objectId?, status?: RelationStatus, reviewerId?: string }`
  - `interface RelationStore { create, findById, findByProject, update, setSourceIds, delete }`
  - `createRelationStore(db: Db): RelationStore`
  - Method signatures:
    - `create(input: CreateRelationInput): Promise<Relation>`
    - `findById(organizationId: string, id: string): Promise<Relation | null>`
    - `findByProject(organizationId: string, filter: RelationFilter): Promise<Relation[]>`
    - `update(organizationId: string, id: string, patch: UpdateRelationPatch): Promise<Relation | null>`
    - `setSourceIds(organizationId: string, id: string, sourceIds: string[]): Promise<Relation | null>`
    - `delete(organizationId: string, id: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
// test/modules/knowledge-core/relation-repository.test.ts
import { describe, expect, it } from "vitest";
import { createRelationStore } from "../../../src/modules/knowledge-core/relation-repository.js";
import { createFakeDb } from "../../support/fake-db.js";

const org = "org_A";
function store() {
  const { db } = createFakeDb({ relations: [] });
  return createRelationStore(db);
}
const base = {
  organizationId: org, projectId: "prj_1", subjectId: "a",
  predicate: "depends_on" as const, objectId: "b", status: "PROPOSED" as const, ownerId: "tok_1",
};

describe("relation-repository", () => {
  it("creates at version 1 with empty sourceIds and null reviewerId", async () => {
    const s = store();
    const rel = await s.create(base);
    expect(rel.id).toMatch(/^rel_/);
    expect(rel.version).toBe(1);
    expect(rel.sourceIds).toEqual([]);
    expect(rel.reviewerId).toBeNull();
  });

  it("finds by id within the tenant only", async () => {
    const s = store();
    const rel = await s.create(base);
    expect(await s.findById(org, rel.id)).not.toBeNull();
    expect(await s.findById("org_other", rel.id)).toBeNull();
  });

  it("filters by predicate and status", async () => {
    const s = store();
    await s.create(base);
    await s.create({ ...base, predicate: "fixes" });
    const depends = await s.findByProject(org, { projectId: "prj_1", predicate: "depends_on" });
    expect(depends).toHaveLength(1);
    expect(depends[0].predicate).toBe("depends_on");
  });

  it("update bumps version and can stamp reviewerId", async () => {
    const s = store();
    const rel = await s.create(base);
    const updated = await s.update(org, rel.id, { status: "ACCEPTED", reviewerId: "tok_2" });
    expect(updated?.version).toBe(2);
    expect(updated?.status).toBe("ACCEPTED");
    expect(updated?.reviewerId).toBe("tok_2");
  });

  it("setSourceIds replaces the array and bumps version", async () => {
    const s = store();
    const rel = await s.create(base);
    const updated = await s.setSourceIds(org, rel.id, ["src_1"]);
    expect(updated?.sourceIds).toEqual(["src_1"]);
    expect(updated?.version).toBe(2);
  });

  it("delete returns true then false", async () => {
    const s = store();
    const rel = await s.create(base);
    expect(await s.delete(org, rel.id)).toBe(true);
    expect(await s.delete(org, rel.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/relation-repository.test.ts`
Expected: FAIL — cannot find module `relation-repository.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/knowledge-core/relation-repository.ts
import type { Db } from "mongodb";
import { newRelationId, type Relation, type RelationPredicate, type RelationStatus } from "./relation-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateRelationInput {
  organizationId: string;
  projectId: string;
  subjectId: string;
  predicate: RelationPredicate;
  objectId: string;
  status: RelationStatus;
  ownerId: string;
}

export interface RelationFilter {
  projectId?: string;
  predicate?: RelationPredicate;
  status?: RelationStatus;
}

export interface UpdateRelationPatch {
  subjectId?: string;
  predicate?: RelationPredicate;
  objectId?: string;
  status?: RelationStatus;
  reviewerId?: string;
}

export interface RelationStore {
  create(input: CreateRelationInput): Promise<Relation>;
  findById(organizationId: string, id: string): Promise<Relation | null>;
  findByProject(organizationId: string, filter: RelationFilter): Promise<Relation[]>;
  update(organizationId: string, id: string, patch: UpdateRelationPatch): Promise<Relation | null>;
  setSourceIds(organizationId: string, id: string, sourceIds: string[]): Promise<Relation | null>;
  delete(organizationId: string, id: string): Promise<boolean>;
}

export function createRelationStore(db: Db): RelationStore {
  const col = () => db.collection<Relation>("relations");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const relation: Relation = {
        id: newRelationId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        subjectId: input.subjectId,
        predicate: input.predicate,
        objectId: input.objectId,
        status: input.status,
        version: 1,
        ownerId: input.ownerId,
        reviewerId: null,
        sourceIds: [],
        createdAt: now,
        updatedAt: now,
        lastVerifiedAt: null,
      };
      await col().insertOne({ ...relation });
      return relation;
    },

    async findById(organizationId, id) {
      return col().findOne({ id, organizationId }, READ_OPTS) as Promise<Relation | null>;
    },

    async findByProject(organizationId, filter) {
      const query: Record<string, unknown> = { organizationId };
      if (filter.projectId !== undefined) query.projectId = filter.projectId;
      if (filter.predicate !== undefined) query.predicate = filter.predicate;
      if (filter.status !== undefined) query.status = filter.status;
      return col().find(query, READ_OPTS).toArray() as Promise<Relation[]>;
    },

    async update(organizationId, id, patch) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { ...patch, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as Relation | null;
    },

    async setSourceIds(organizationId, id, sourceIds) {
      const result = await col().findOneAndUpdate(
        { id, organizationId },
        { $set: { sourceIds, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
        { returnDocument: "after", projection: { _id: 0 } },
      );
      return result as Relation | null;
    },

    async delete(organizationId, id) {
      const result = await col().deleteOne({ id, organizationId });
      return result.deletedCount > 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/relation-repository.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/relation-repository.ts test/modules/knowledge-core/relation-repository.test.ts
git commit -m "feat: add Relation repository (PM-015)"
```

---

### Task 4: Relation version entities + repository

**Files:**
- Create: `src/modules/knowledge-core/relation-version-entities.ts`
- Create: `src/modules/knowledge-core/relation-version-repository.ts`
- Test: `test/modules/knowledge-core/relation-version-repository.test.ts`

**Interfaces:**
- Consumes: `Relation` from `relation-entities.js`; `Db` from `mongodb`.
- Produces:
  - `interface RelationVersion { id, organizationId, relationId, version: number, snapshot: Relation, changedBy, changedAt, changeSummary }`
  - `relationVersionIdSchema: ZodString`, `newRelationVersionId(): string` → `"rver_" + ulid()`
  - `interface AppendRelationVersionInput { organizationId, relationId, version: number, snapshot: Relation, changedBy, changeSummary }`
  - `interface RelationVersionStore { append, listByRelation, findByVersion }`
  - `createRelationVersionStore(db: Db): RelationVersionStore`
  - `append(input: AppendRelationVersionInput): Promise<RelationVersion>`
  - `listByRelation(organizationId: string, relationId: string): Promise<RelationVersion[]>` (sorted by version asc)
  - `findByVersion(organizationId: string, relationId: string, version: number): Promise<RelationVersion | null>`

- [ ] **Step 1: Write the failing test**

```ts
// test/modules/knowledge-core/relation-version-repository.test.ts
import { describe, expect, it } from "vitest";
import { createRelationVersionStore } from "../../../src/modules/knowledge-core/relation-version-repository.js";
import { relationVersionIdSchema, newRelationVersionId } from "../../../src/modules/knowledge-core/relation-version-entities.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { Relation } from "../../../src/modules/knowledge-core/relation-entities.js";

const org = "org_A";
const snapshot = (version: number): Relation => ({
  id: "rel_x", organizationId: org, projectId: "prj_1", subjectId: "a",
  predicate: "depends_on", objectId: "b", status: "PROPOSED", version,
  ownerId: "tok_1", reviewerId: null, sourceIds: [], createdAt: "", updatedAt: "", lastVerifiedAt: null,
});
function store() {
  const { db } = createFakeDb({ relation_versions: [] });
  return createRelationVersionStore(db);
}

describe("relation-version-repository", () => {
  it("mints version ids matching the schema", () => {
    expect(relationVersionIdSchema.safeParse(newRelationVersionId()).success).toBe(true);
  });

  it("appends and lists by relation in version order", async () => {
    const s = store();
    await s.append({ organizationId: org, relationId: "rel_x", version: 2, snapshot: snapshot(2), changedBy: "tok_1", changeSummary: "second" });
    await s.append({ organizationId: org, relationId: "rel_x", version: 1, snapshot: snapshot(1), changedBy: "tok_1", changeSummary: "initial version" });
    const list = await s.listByRelation(org, "rel_x");
    expect(list.map((v) => v.version)).toEqual([1, 2]);
  });

  it("finds a specific version", async () => {
    const s = store();
    await s.append({ organizationId: org, relationId: "rel_x", version: 1, snapshot: snapshot(1), changedBy: "tok_1", changeSummary: "initial version" });
    const v = await s.findByVersion(org, "rel_x", 1);
    expect(v?.snapshot.version).toBe(1);
    expect(await s.findByVersion(org, "rel_x", 99)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/relation-version-repository.test.ts`
Expected: FAIL — cannot find module `relation-version-repository.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/knowledge-core/relation-version-entities.ts
import { ulid } from "ulid";
import { z } from "zod";
import type { Relation } from "./relation-entities.js";

export interface RelationVersion {
  id: string;
  organizationId: string;
  relationId: string;
  version: number;
  snapshot: Relation;
  changedBy: string;
  changedAt: string;
  changeSummary: string;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const relationVersionIdSchema = z.string().regex(/^rver_[0-9A-HJKMNP-TV-Z]{26}$/);

export function newRelationVersionId(): string {
  return `rver_${ulid()}`;
}
```

```ts
// src/modules/knowledge-core/relation-version-repository.ts
import type { Db } from "mongodb";
import { newRelationVersionId, type RelationVersion } from "./relation-version-entities.js";
import type { Relation } from "./relation-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface AppendRelationVersionInput {
  organizationId: string;
  relationId: string;
  version: number;
  snapshot: Relation;
  changedBy: string;
  changeSummary: string;
}

export interface RelationVersionStore {
  append(input: AppendRelationVersionInput): Promise<RelationVersion>;
  listByRelation(organizationId: string, relationId: string): Promise<RelationVersion[]>;
  findByVersion(organizationId: string, relationId: string, version: number): Promise<RelationVersion | null>;
}

export function createRelationVersionStore(db: Db): RelationVersionStore {
  const col = () => db.collection<RelationVersion>("relation_versions");

  return {
    async append(input) {
      const record: RelationVersion = {
        id: newRelationVersionId(),
        organizationId: input.organizationId,
        relationId: input.relationId,
        version: input.version,
        snapshot: input.snapshot,
        changedBy: input.changedBy,
        changedAt: new Date().toISOString(),
        changeSummary: input.changeSummary,
      };
      await col().insertOne({ ...record });
      return record;
    },

    async listByRelation(organizationId, relationId) {
      return col()
        .find({ organizationId, relationId }, READ_OPTS)
        .sort({ version: 1 })
        .toArray() as Promise<RelationVersion[]>;
    },

    async findByVersion(organizationId, relationId, version) {
      return col().findOne({ organizationId, relationId, version }, READ_OPTS) as Promise<RelationVersion | null>;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/relation-version-repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/relation-version-entities.ts src/modules/knowledge-core/relation-version-repository.ts test/modules/knowledge-core/relation-version-repository.test.ts
git commit -m "feat: add Relation version store (PM-015)"
```

---

### Task 5: Indexes + RelationNotFoundError

**Files:**
- Modify: `src/lib/indexes.ts` — add `relation_versions` to `CORE_COLLECTIONS`; add extra indexes for `relations` and `relation_versions`.
- Modify: `src/lib/errors.ts` — add `RelationNotFoundError`.
- Test: `test/lib/indexes.test.ts` (extend), `test/lib/errors.test.ts` (extend).

**Interfaces:**
- Consumes: existing `CORE_COLLECTIONS`, `CORE_COLLECTION_EXTRA_INDEXES`, `AppError`.
- Produces: `class RelationNotFoundError extends AppError` (404, `RELATION_NOT_FOUND`); `relations`/`relation_versions` index specs available via `CORE_INDEXES`.

- [ ] **Step 1: Write the failing tests**

Add to `test/lib/errors.test.ts`:

```ts
import { RelationNotFoundError } from "../../src/lib/errors.js";

describe("RelationNotFoundError", () => {
  it("is a 404 with RELATION_NOT_FOUND code", () => {
    const err = new RelationNotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("RELATION_NOT_FOUND");
  });
});
```

Add to `test/lib/indexes.test.ts`:

```ts
import { CORE_INDEXES } from "../../src/lib/indexes.js";

describe("relation indexes", () => {
  it("declares relations with a unique id index and predicate/status lookups", () => {
    const relations = CORE_INDEXES.find((c) => c.collection === "relations");
    const names = relations?.indexes.map((i) => i.name) ?? [];
    expect(names).toContain("id_unique");
    expect(names).toContain("project_predicate");
    expect(names).toContain("project_status");
  });

  it("declares relation_versions with id and relation lookup indexes", () => {
    const versions = CORE_INDEXES.find((c) => c.collection === "relation_versions");
    const names = versions?.indexes.map((i) => i.name) ?? [];
    expect(names).toContain("id_unique");
    expect(names).toContain("relation_lookup");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/lib/errors.test.ts test/lib/indexes.test.ts`
Expected: FAIL — `RelationNotFoundError` undefined; `relation_versions` not found in `CORE_INDEXES`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/errors.ts`, add after `FactNotFoundError`:

```ts
export class RelationNotFoundError extends AppError {
  constructor(message = "relation not found") {
    super(message, 404, "RELATION_NOT_FOUND");
  }
}
```

In `src/lib/indexes.ts`, add `"relation_versions"` to the `CORE_COLLECTIONS` array (after `"fact_versions"`; `"relations"` is already present), and add these entries to `CORE_COLLECTION_EXTRA_INDEXES`:

```ts
  relations: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, projectId: 1, predicate: 1 }, name: "project_predicate" },
    { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
  ],
  relation_versions: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { organizationId: 1, relationId: 1 }, name: "relation_lookup" },
  ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/lib/errors.test.ts test/lib/indexes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes.ts src/lib/errors.ts test/lib/indexes.test.ts test/lib/errors.test.ts
git commit -m "feat: declare relations/relation_versions indexes and RelationNotFoundError (PM-015)"
```

---

### Task 6: Relation CRUD + source routes

**Files:**
- Create: `src/routes/relations.ts`
- Modify: `src/app.ts` — import and call `registerRelationRoutes(app)`.
- Test: `test/routes/relations.test.ts`

**Interfaces:**
- Consumes: `createRelationBodySchema`, `updateRelationBodySchema`, `relationIdSchema`, `relationPredicateSchema`, `relationStatusSchema` from `relation-entities.js`; `createRelationStore`, `RelationFilter` from `relation-repository.js`; `createRelationVersionStore` from `relation-version-repository.js`; `assertRelationTransition`, `INITIAL_RELATION_STATUS` from `relation-lifecycle.js`; `sourceIdSchema`, `createSourceStore` from source modules; `projectIdSchema`, `createProjectContextRepository`; errors incl. `RelationNotFoundError`, `SourceNotFoundError`.
- Produces: `registerRelationRoutes(app: FastifyInstance): void` registering `POST/GET/GET-list/PATCH/DELETE /relations`, `POST /relations/:id/sources`, `DELETE /relations/:id/sources/:sourceId`.

- [ ] **Step 1: Write the failing test**

```ts
// test/routes/relations.test.ts
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerRelationRoutes } from "../../src/routes/relations.js";
import { registerSourceRoutes } from "../../src/routes/sources.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

const seeded = (): Collections => ({
  projects: [project],
  relations: [],
  relation_versions: [],
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
  registerRelationRoutes(app);
  registerSourceRoutes(app);
  return app;
}

const validBody = { projectId, subjectId: "matter-history", predicate: "depends_on", objectId: "audit-log" };
const create = (app: FastifyInstance, body: Record<string, unknown> = validBody) =>
  app.inject({ method: "POST", url: "/relations", payload: body });

async function seedSource(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sources", payload: { projectId, type: "git_commit", locator: "abc123" } });
  return (res.json() as { id: string }).id;
}

describe("POST /relations", () => {
  it("creates at version 1, PROPOSED, null reviewer, 201", async () => {
    const app = buildApp(seeded());
    const res = await create(app);
    expect(res.statusCode).toBe(201);
    const rel = res.json();
    expect(rel.id).toMatch(/^rel_/);
    expect(rel.version).toBe(1);
    expect(rel.status).toBe("PROPOSED");
    expect(rel.reviewerId).toBeNull();
    await app.close();
  });

  it("rejects an off-vocabulary predicate with 400", async () => {
    const app = buildApp(seeded());
    const res = await create(app, { ...validBody, predicate: "causes" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404 when project does not exist", async () => {
    const app = buildApp(seeded());
    const res = await create(app, { ...validBody, projectId: newProjectId() });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /relations/:id reviewer stamping", () => {
  it("stamps reviewerId on PROPOSED -> ACCEPTED", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "ACCEPTED" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().reviewerId).toBe("tok_1");
    await app.close();
  });

  it("rejects an illegal transition with 422", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "DEPRECATED" } });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it("does not re-stamp reviewer on ACCEPTED -> DEPRECATED", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "ACCEPTED" } });
    const dep = await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "DEPRECATED" } });
    expect(dep.json().reviewerId).toBe("tok_1");
    await app.close();
  });
});

describe("GET /relations filters and 404s", () => {
  it("filters by predicate", async () => {
    const app = buildApp(seeded());
    await create(app);
    await create(app, { ...validBody, predicate: "fixes" });
    const res = await app.inject({ method: "GET", url: `/relations?projectId=${projectId}&predicate=depends_on` });
    expect(res.json().relations).toHaveLength(1);
    await app.close();
  });

  it("404 on unknown id", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({ method: "GET", url: "/relations/rel_00000000000000000000000000" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("relation sources", () => {
  it("attaches idempotently and detaches", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const sourceId = await seedSource(app);
    const a1 = await app.inject({ method: "POST", url: `/relations/${id}/sources`, payload: { sourceId } });
    expect(a1.json().sourceIds).toEqual([sourceId]);
    const a2 = await app.inject({ method: "POST", url: `/relations/${id}/sources`, payload: { sourceId } });
    expect(a2.json().sourceIds).toEqual([sourceId]); // idempotent
    const d = await app.inject({ method: "DELETE", url: `/relations/${id}/sources/${sourceId}` });
    expect(d.json().sourceIds).toEqual([]);
    await app.close();
  });
});

describe("DELETE /relations/:id", () => {
  it("204 then 404", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    expect((await app.inject({ method: "DELETE", url: `/relations/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/relations/${id}` })).statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes/relations.test.ts`
Expected: FAIL — cannot find module `relations.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/routes/relations.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRepository as createProjectContextRepository } from "../modules/project-context/repository.js";
import { projectIdSchema } from "../modules/project-context/entities.js";
import type { ProjectContext } from "../modules/project-context/context.js";
import {
  createRelationBodySchema,
  relationIdSchema,
  relationPredicateSchema,
  relationStatusSchema,
  updateRelationBodySchema,
} from "../modules/knowledge-core/relation-entities.js";
import { createRelationStore, type RelationFilter } from "../modules/knowledge-core/relation-repository.js";
import { createRelationVersionStore } from "../modules/knowledge-core/relation-version-repository.js";
import { assertRelationTransition, INITIAL_RELATION_STATUS } from "../modules/knowledge-core/relation-lifecycle.js";
import { sourceIdSchema } from "../modules/knowledge-core/source-entities.js";
import { createSourceStore } from "../modules/knowledge-core/source-repository.js";
import {
  InvalidTenantScopeError,
  RelationNotFoundError,
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

function assertRelationId(id: string): void {
  if (!relationIdSchema.safeParse(id).success) throw new ValidationError("relation id is malformed");
}

export function registerRelationRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const projects = () => createProjectContextRepository(app.db);
  const store = () => createRelationStore(app.db);
  const vStore = () => createRelationVersionStore(app.db);
  const sourceStore = () => createSourceStore(app.db);

  async function requireProject(organizationId: string, projectId: string): Promise<void> {
    if (!(await projects().getProject(organizationId, projectId))) throw new TenantNotFoundError();
  }

  app.post("/relations", BEARER, async (req, reply) => {
    const actor = requireActor(req);
    const ctx = context(req);

    const parsed = createRelationBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError("invalid relation body");
    const body = parsed.data;

    if (!projectIdSchema.safeParse(body.projectId).success) {
      throw new ValidationError("projectId is malformed");
    }
    await requireProject(ctx.organizationId, body.projectId);

    const relation = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      subjectId: body.subjectId,
      predicate: body.predicate,
      objectId: body.objectId,
      status: INITIAL_RELATION_STATUS,
      ownerId: actor.actorId,
    });
    await vStore().append({
      organizationId: ctx.organizationId,
      relationId: relation.id,
      version: relation.version,
      snapshot: relation,
      changedBy: actor.actorId,
      changeSummary: "initial version",
    });
    reply.status(201);
    return relation;
  });

  app.get("/relations/:id", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);
    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();
    return relation;
  });

  app.get("/relations", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const query = req.query as { projectId?: string; predicate?: string; status?: string };
    const filter: RelationFilter = {};

    if (query.projectId !== undefined) {
      if (!projectIdSchema.safeParse(query.projectId).success) {
        throw new ValidationError("projectId is malformed");
      }
      await requireProject(ctx.organizationId, query.projectId);
      filter.projectId = query.projectId;
    }
    if (query.predicate !== undefined) {
      const p = relationPredicateSchema.safeParse(query.predicate);
      if (!p.success) throw new ValidationError("predicate filter is invalid");
      filter.predicate = p.data;
    }
    if (query.status !== undefined) {
      const s = relationStatusSchema.safeParse(query.status);
      if (!s.success) throw new ValidationError("status filter is invalid");
      filter.status = s.data;
    }

    return { relations: await store().findByProject(ctx.organizationId, filter) };
  });

  app.patch("/relations/:id", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);

    const parsed = updateRelationBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("invalid relation patch");
    const rawPatch = parsed.data;
    const callerSummary = rawPatch.changeSummary;
    const patch = { ...rawPatch } as Record<string, unknown>;
    delete patch.changeSummary;
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("patch must contain at least one field");
    }

    const existing = await store().findById(ctx.organizationId, id);
    if (!existing) throw new RelationNotFoundError();

    if (patch.status !== undefined && patch.status !== existing.status) {
      assertRelationTransition(existing.status, patch.status as typeof existing.status);
      // Stamp reviewer when the relation leaves PROPOSED (the decision edge).
      if (existing.status === "PROPOSED") {
        patch.reviewerId = actor.actorId;
      }
    }

    const updated = await store().update(ctx.organizationId, id, patch);
    if (!updated) throw new RelationNotFoundError();

    const changedFields = Object.keys(patch);
    const changeSummary = callerSummary ?? `changed: ${changedFields.join(", ")}`;

    await vStore().append({
      organizationId: ctx.organizationId,
      relationId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary,
    });
    return updated;
  });

  app.post("/relations/:id/sources", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);

    const body = (req.body ?? {}) as { sourceId?: unknown };
    if (!sourceIdSchema.safeParse(body.sourceId).success) throw new ValidationError("sourceId is malformed");
    const sourceId = body.sourceId as string;

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    const source = await sourceStore().findById(ctx.organizationId, sourceId);
    if (!source) throw new SourceNotFoundError();

    const current = relation.sourceIds ?? [];
    if (current.includes(sourceId)) return relation; // idempotent

    const updated = await store().setSourceIds(ctx.organizationId, id, [...current, sourceId]);
    if (!updated) throw new RelationNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      relationId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `attached source ${sourceId}`,
    });
    return updated;
  });

  app.delete("/relations/:id/sources/:sourceId", BEARER, async (req) => {
    const actor = requireActor(req);
    const ctx = context(req);
    const { id, sourceId } = req.params as { id: string; sourceId: string };
    assertRelationId(id);
    if (!sourceIdSchema.safeParse(sourceId).success) throw new ValidationError("sourceId is malformed");

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    const current = relation.sourceIds ?? [];
    if (!current.includes(sourceId)) throw new SourceNotFoundError();

    const updated = await store().setSourceIds(ctx.organizationId, id, current.filter((s) => s !== sourceId));
    if (!updated) throw new RelationNotFoundError();

    await vStore().append({
      organizationId: ctx.organizationId,
      relationId: updated.id,
      version: updated.version,
      snapshot: updated,
      changedBy: actor.actorId,
      changeSummary: `detached source ${sourceId}`,
    });
    return updated;
  });

  app.delete("/relations/:id", BEARER, async (req, reply) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);

    const removed = await store().delete(ctx.organizationId, id);
    if (!removed) throw new RelationNotFoundError();
    reply.status(204);
    return null;
  });
}
```

Then in `src/app.ts`: add `import { registerRelationRoutes } from "./routes/relations.js";` near the other route imports, and add `registerRelationRoutes(app);` after `registerFactVersionRoutes(app);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes/relations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/relations.ts src/app.ts test/routes/relations.test.ts
git commit -m "feat: add Relation CRUD and source routes (PM-015)"
```

---

### Task 7: Relation version routes

**Files:**
- Create: `src/routes/relation-versions.ts`
- Modify: `src/app.ts` — import and call `registerRelationVersionRoutes(app)`.
- Test: `test/routes/relation-versions.test.ts`

**Interfaces:**
- Consumes: `relationIdSchema`, `Relation` from `relation-entities.js`; `createRelationStore` from `relation-repository.js`; `createRelationVersionStore` from `relation-version-repository.js`; `RelationNotFoundError` and other errors.
- Produces: `registerRelationVersionRoutes(app: FastifyInstance): void` registering `GET /relations/:id/versions`, `GET /relations/:id/versions/:v`, `GET /relations/:id/versions/:from/diff/:to`.

- [ ] **Step 1: Write the failing test**

```ts
// test/routes/relation-versions.test.ts
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerRelationRoutes } from "../../src/routes/relations.js";
import { registerRelationVersionRoutes } from "../../src/routes/relation-versions.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };
const seeded = (): Collections => ({ projects: [project], relations: [], relation_versions: [] });

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
  registerRelationRoutes(app);
  registerRelationVersionRoutes(app);
  return app;
}

const validBody = { projectId, subjectId: "a", predicate: "depends_on", objectId: "b" };
const create = (app: FastifyInstance) => app.inject({ method: "POST", url: "/relations", payload: validBody });

describe("relation versions", () => {
  it("lists an initial version after create", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "GET", url: `/relations/${id}/versions` });
    expect(res.json().versions).toHaveLength(1);
    expect(res.json().versions[0].version).toBe(1);
    await app.close();
  });

  it("records a new version per write and diffs two versions", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    await app.inject({ method: "PATCH", url: `/relations/${id}`, payload: { status: "ACCEPTED" } });
    const list = await app.inject({ method: "GET", url: `/relations/${id}/versions` });
    expect(list.json().versions).toHaveLength(2);
    const diff = await app.inject({ method: "GET", url: `/relations/${id}/versions/1/diff/2` });
    expect(diff.json().changes.status).toEqual({ from: "PROPOSED", to: "ACCEPTED" });
    expect(diff.json().changes.reviewerId).toEqual({ from: null, to: "tok_1" });
    expect(diff.json().changes.version).toBeUndefined();
    await app.close();
  });

  it("404 on unknown version", async () => {
    const app = buildApp(seeded());
    const id = (await create(app)).json().id;
    const res = await app.inject({ method: "GET", url: `/relations/${id}/versions/99` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes/relation-versions.test.ts`
Expected: FAIL — cannot find module `relation-versions.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/routes/relation-versions.ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { relationIdSchema } from "../modules/knowledge-core/relation-entities.js";
import type { Relation } from "../modules/knowledge-core/relation-entities.js";
import { createRelationStore } from "../modules/knowledge-core/relation-repository.js";
import { createRelationVersionStore } from "../modules/knowledge-core/relation-version-repository.js";
import {
  InvalidTenantScopeError,
  RelationNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import type { ProjectContext } from "../modules/project-context/context.js";

const DIFF_EXCLUDE = new Set<string>(["version", "updatedAt"]);

function diffSnapshots(a: Relation, b: Relation): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const from = a as unknown as Record<string, unknown>;
  const to = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) {
    if (DIFF_EXCLUDE.has(key)) continue;
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
      changes[key] = { from: from[key], to: to[key] };
    }
  }
  return changes;
}

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new InvalidTenantScopeError("x-organization-id is missing or malformed");
  return ctx;
}

function requireActor(req: FastifyRequest): void {
  if (!req.actor) throw new UnauthorizedError("missing credentials");
}

function assertRelationId(id: string): void {
  if (!relationIdSchema.safeParse(id).success) throw new ValidationError("relation id is malformed");
}

function parseVersion(raw: string): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) throw new ValidationError("version must be an integer >= 1");
  return v;
}

export function registerRelationVersionRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const store = () => createRelationStore(app.db);
  const vStore = () => createRelationVersionStore(app.db);

  app.get("/relations/:id/versions", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id } = req.params as { id: string };
    assertRelationId(id);

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    return { versions: await vStore().listByRelation(ctx.organizationId, id) };
  });

  app.get("/relations/:id/versions/:v", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id, v } = req.params as { id: string; v: string };
    assertRelationId(id);
    const vNum = parseVersion(v);

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    const version = await vStore().findByVersion(ctx.organizationId, id, vNum);
    if (!version) throw new RelationNotFoundError("version not found");
    return version;
  });

  app.get("/relations/:id/versions/:from/diff/:to", BEARER, async (req) => {
    requireActor(req);
    const ctx = context(req);
    const { id, from, to } = req.params as { id: string; from: string; to: string };
    assertRelationId(id);
    const fromNum = parseVersion(from);
    const toNum = parseVersion(to);

    const relation = await store().findById(ctx.organizationId, id);
    if (!relation) throw new RelationNotFoundError();

    const [vFrom, vTo] = await Promise.all([
      vStore().findByVersion(ctx.organizationId, id, fromNum),
      vStore().findByVersion(ctx.organizationId, id, toNum),
    ]);
    if (!vFrom || !vTo) throw new RelationNotFoundError("one or both versions not found");

    return { from: fromNum, to: toNum, changes: diffSnapshots(vFrom.snapshot, vTo.snapshot) };
  });
}
```

Then in `src/app.ts`: add `import { registerRelationVersionRoutes } from "./routes/relation-versions.js";` and call `registerRelationVersionRoutes(app);` after `registerRelationRoutes(app);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes/relation-versions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/relation-versions.ts src/app.ts test/routes/relation-versions.test.ts
git commit -m "feat: add Relation version routes (PM-015)"
```

---

### Task 8: Full verification + docs

**Files:**
- Modify: `docs/03-domain/domain-model.md` — no change needed (Relations already documented); verify only.
- Verify: whole suite green, lint + typecheck clean.

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: lint clean, typecheck clean, all tests PASS (existing + the new relation suites).

- [ ] **Step 2: If anything fails, fix it**

Common issues:
- Missing `.js` extension on a relative import → add it.
- `patch as Record<string, unknown>` cast in the PATCH handler: keep the cast local so `reviewerId` can be added without widening the schema type.
- Fake-db `findOneAndUpdate` returns the stripped row directly (not `{ value }`), matching the repository's `returnDocument: "after"` usage — no change needed.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "test: PM-015 relation model full suite green"
```

- [ ] **Step 4: Mark the model landed in the module README (optional, mirrors PM-014)**

If `src/modules/knowledge-core/README.md` lists shipped models, add a `Relation` line. Then:

```bash
git add src/modules/knowledge-core/README.md
git commit -m "docs: mark Relation model as landed in knowledge-core (PM-015)"
```

---

## Self-Review

**1. Spec coverage:**
- Fixed predicate vocabulary (Decision 1) → Task 1 (`relationPredicateSchema`), enforced in create/patch + filters (Task 6).
- Reviewer stamping on decision edge (Decision 2) → Task 6 PATCH handler + tests (stamp on ACCEPT/REJECT, not re-stamped on DEPRECATE).
- Compact lifecycle (Decision 3) → Task 2 + Task 6 transition test.
- Full versioning + sources (Decision 4) → Task 4 (version store), Task 6 (source attach/detach), Task 7 (version routes).
- Free-form subject/object (Decision 5) → Task 1 schemas use `nonEmpty` strings, no referential checks.
- `RelationNotFoundError` + indexes → Task 5.
- Route registration → Tasks 6 & 7 modify `app.ts`.
- Out-of-scope items (generic version store, impact analysis, MCP, separation-of-duties) → correctly absent.

**2. Placeholder scan:** No TBD/TODO; all code steps contain full code; no "similar to Task N" references (code repeated where needed).

**3. Type consistency:** `createRelationStore`, `createRelationVersionStore`, `RelationFilter`, `UpdateRelationPatch` (incl. `reviewerId?`), `assertRelationTransition`, `INITIAL_RELATION_STATUS`, `relationPredicateSchema`, `relationStatusSchema`, `newRelationVersionId` used consistently across tasks. Version store method `listByRelation` named identically in Task 4 (definition) and Task 7 (consumer).
