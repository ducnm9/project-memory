# Knowledge Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every successful `PATCH` on a `KnowledgeItem` creates an immutable version snapshot; `POST` creates version 1; three read endpoints expose history and diff.

**Architecture:** A new append-only `knowledge_versions` MongoDB collection stores one `KnowledgeVersion` document per item version. `findOneAndUpdate` on `knowledge_items` uses `$inc: { version: 1 }` for atomic version increment. The existing `PATCH` route is extended to strip `changeSummary` from the patch, then call the version store after saving the item.

**Tech Stack:** TypeScript, Fastify, MongoDB (via `mongodb` driver), Vitest, ULID (`ulid` package).

**Spec:** `docs/superpowers/specs/2026-09-21-knowledge-versioning-design.md`

## Global Constraints

- All new collections use `projection: { _id: 0 }` on reads.
- All `id` fields use prefixed ULIDs (`kver_` for versions, matching `know_` style).
- Every query is tenant-scoped by `organizationId`.
- `version` is set atomically by `$inc` in the DB — never computed in app code.
- `changeSummary` is NOT stored on `KnowledgeItem`; it lives only in `KnowledgeVersion`.
- Reuse existing errors from `src/lib/errors.ts`; add no new error classes.
- Test files follow `test/routes/knowledge.test.ts` conventions: `createFakeDb`, `app.inject`, `res.json().error.code`.

---

### Task 1: Extend fake-db to support `$inc` and `sort`

The in-memory fake DB used by all route tests currently ignores `$inc` in
`findOneAndUpdate` and has no `.sort()` on `find`. This task fixes both before
any other code runs.

**Files:**
- Modify: `test/support/fake-db.ts`

**Interfaces:**
- Produces: `findOneAndUpdate(filter, { $set?, $inc? })` that applies both operators; `find(filter).sort(spec).toArray()` that sorts results.

- [ ] **Step 1: Write failing test for `$inc`**

Add a new file `test/support/fake-db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakeDb } from "./fake-db.js";

describe("fake-db", () => {
  it("applies $inc in findOneAndUpdate", async () => {
    const { db } = createFakeDb({ things: [{ id: "a", organizationId: "o", count: 1 }] });
    const col = db.collection("things") as any;
    const result = await col.findOneAndUpdate(
      { id: "a", organizationId: "o" },
      { $set: { name: "x" }, $inc: { count: 1 } },
    );
    expect(result.count).toBe(2);
    expect(result.name).toBe("x");
  });

  it("sort ascending on find", async () => {
    const { db } = createFakeDb({
      things: [
        { id: "a", organizationId: "o", v: 3 },
        { id: "b", organizationId: "o", v: 1 },
        { id: "c", organizationId: "o", v: 2 },
      ],
    });
    const col = db.collection("things") as any;
    const result = await col.find({ organizationId: "o" }).sort({ v: 1 }).toArray();
    expect(result.map((r: any) => r.v)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/support/fake-db.test.ts
```

Expected: FAIL — `$inc` not applied, sort not a function.

- [ ] **Step 3: Implement `$inc` and `sort` support in fake-db**

Replace the `findOneAndUpdate` and `find` methods in `test/support/fake-db.ts`:

```ts
findOneAndUpdate: async (filter: Row, update: { $set?: Row; $inc?: Row }) => {
  const row = list.find((r) => matches(r, filter));
  if (!row) return null;
  if (update.$set) Object.assign(row, update.$set);
  if (update.$inc) {
    for (const [key, delta] of Object.entries(update.$inc)) {
      row[key] = ((row[key] as number) ?? 0) + (delta as number);
    }
  }
  return stripId(row);
},
```

Replace `find` to return a chainable object:

```ts
find: (filter: Row) => {
  let _sortKey: string | null = null;
  let _sortDir: 1 | -1 = 1;
  return {
    sort: (spec: Record<string, 1 | -1>) => {
      const [key, dir] = Object.entries(spec)[0];
      _sortKey = key;
      _sortDir = dir;
      return { toArray };
    },
    toArray,
  };
  function toArray() {
    let results = list.filter((r) => matches(r, filter)).map(stripId);
    if (_sortKey) {
      const key = _sortKey;
      const dir = _sortDir;
      results = results.sort((a, b) => {
        const av = a[key] as number;
        const bv = b[key] as number;
        return dir * (av < bv ? -1 : av > bv ? 1 : 0);
      });
    }
    return Promise.resolve(results);
  }
},
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/support/fake-db.test.ts
```

Expected: PASS — both `$inc` and `sort` tests green.

- [ ] **Step 5: Run full test suite to confirm nothing regressed**

```bash
npx vitest run
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add test/support/fake-db.ts test/support/fake-db.test.ts
git commit -m "test(support): add \$inc and sort support to fake-db"
```

---

### Task 2: `KnowledgeVersion` entity and ID helper

Add the `KnowledgeVersion` type and `newKnowledgeVersionId()` in a dedicated
file to keep `entities.ts` focused.

**Files:**
- Create: `src/modules/knowledge-core/version-entities.ts`

**Interfaces:**
- Consumes: `KnowledgeItem` from `./entities.js`
- Produces:
  ```ts
  interface KnowledgeVersion { id, organizationId, knowledgeId, version, snapshot, changedBy, changedAt, changeSummary }
  function newKnowledgeVersionId(): string  // returns "kver_" + ULID
  const knowledgeVersionIdSchema: z.ZodString  // regex /^kver_[0-9A-HJKMNP-TV-Z]{26}$/
  ```

- [ ] **Step 1: Write failing test**

Create `test/modules/knowledge-core/version-entities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newKnowledgeVersionId, knowledgeVersionIdSchema } from "../../../src/modules/knowledge-core/version-entities.js";

describe("version-entities", () => {
  it("generates a kver_ prefixed id", () => {
    const id = newKnowledgeVersionId();
    expect(id).toMatch(/^kver_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("knowledgeVersionIdSchema validates a correct id", () => {
    const id = newKnowledgeVersionId();
    expect(knowledgeVersionIdSchema.safeParse(id).success).toBe(true);
  });

  it("knowledgeVersionIdSchema rejects garbage", () => {
    expect(knowledgeVersionIdSchema.safeParse("bad").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/modules/knowledge-core/version-entities.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `version-entities.ts`**

Create `src/modules/knowledge-core/version-entities.ts`:

```ts
import { ulid } from "ulid";
import { z } from "zod";
import type { KnowledgeItem } from "./entities.js";

export interface KnowledgeVersion {
  id: string;
  organizationId: string;
  knowledgeId: string;
  version: number;
  snapshot: KnowledgeItem;
  changedBy: string;
  changedAt: string;
  changeSummary: string;
}

export const knowledgeVersionIdSchema = z
  .string()
  .regex(/^kver_[0-9A-HJKMNP-TV-Z]{26}$/);

export function newKnowledgeVersionId(): string {
  return `kver_${ulid()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/modules/knowledge-core/version-entities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/version-entities.ts \
        test/modules/knowledge-core/version-entities.test.ts
git commit -m "feat(pm-012): add KnowledgeVersion entity and id helper"
```

---

### Task 3: `KnowledgeVersionStore` repository

Append-only MongoDB repository for the `knowledge_versions` collection.

**Files:**
- Create: `src/modules/knowledge-core/version-repository.ts`
- Test: `test/modules/knowledge-core/version-repository.test.ts`

**Interfaces:**
- Consumes: `KnowledgeVersion`, `newKnowledgeVersionId` from `./version-entities.js`; `Db` from `mongodb`
- Produces:
  ```ts
  interface AppendVersionInput {
    organizationId: string;
    knowledgeId: string;
    version: number;
    snapshot: KnowledgeItem;
    changedBy: string;
    changeSummary: string;
  }
  interface KnowledgeVersionStore {
    append(input: AppendVersionInput): Promise<KnowledgeVersion>;
    listByKnowledge(organizationId: string, knowledgeId: string): Promise<KnowledgeVersion[]>;
    findByVersion(organizationId: string, knowledgeId: string, version: number): Promise<KnowledgeVersion | null>;
  }
  function createKnowledgeVersionStore(db: Db): KnowledgeVersionStore
  ```

- [ ] **Step 1: Write failing tests**

Create `test/modules/knowledge-core/version-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createKnowledgeVersionStore } from "../../../src/modules/knowledge-core/version-repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { KnowledgeItem } from "../../../src/modules/knowledge-core/entities.js";

const orgId = "org_A";

function makeSnapshot(version: number): KnowledgeItem {
  return {
    id: "know_TEST",
    organizationId: orgId,
    projectId: "proj_A",
    type: "Fact",
    title: "t",
    summary: "s",
    content: { subject: "x", predicate: "is" },
    status: "PUBLISHED",
    version,
    ownerId: "tok_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: null,
  };
}

describe("KnowledgeVersionStore", () => {
  it("appends a version and returns it with a kver_ id", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    const v = await store.append({
      organizationId: orgId,
      knowledgeId: "know_TEST",
      version: 1,
      snapshot: makeSnapshot(1),
      changedBy: "tok_1",
      changeSummary: "initial version",
    });
    expect(v.id).toMatch(/^kver_/);
    expect(v.version).toBe(1);
    expect(v.changeSummary).toBe("initial version");
    expect(v.snapshot.version).toBe(1);
  });

  it("listByKnowledge returns versions sorted ascending", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 2, snapshot: makeSnapshot(2), changedBy: "tok_1", changeSummary: "c2" });
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 1, snapshot: makeSnapshot(1), changedBy: "tok_1", changeSummary: "c1" });
    const list = await store.listByKnowledge(orgId, "know_TEST");
    expect(list.map((v) => v.version)).toEqual([1, 2]);
  });

  it("listByKnowledge is tenant-scoped", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 1, snapshot: makeSnapshot(1), changedBy: "tok_1", changeSummary: "c" });
    const list = await store.listByKnowledge("org_OTHER", "know_TEST");
    expect(list).toHaveLength(0);
  });

  it("findByVersion returns the correct snapshot", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 1, snapshot: makeSnapshot(1), changedBy: "tok_1", changeSummary: "c" });
    await store.append({ organizationId: orgId, knowledgeId: "know_TEST", version: 2, snapshot: makeSnapshot(2), changedBy: "tok_1", changeSummary: "c2" });
    const v = await store.findByVersion(orgId, "know_TEST", 1);
    expect(v?.version).toBe(1);
    expect(v?.snapshot.version).toBe(1);
  });

  it("findByVersion returns null for missing version", async () => {
    const { db } = createFakeDb();
    const store = createKnowledgeVersionStore(db);
    const v = await store.findByVersion(orgId, "know_TEST", 99);
    expect(v).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/modules/knowledge-core/version-repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `version-repository.ts`**

Create `src/modules/knowledge-core/version-repository.ts`:

```ts
import type { Db } from "mongodb";
import {
  newKnowledgeVersionId,
  type KnowledgeVersion,
} from "./version-entities.js";
import type { KnowledgeItem } from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface AppendVersionInput {
  organizationId: string;
  knowledgeId: string;
  version: number;
  snapshot: KnowledgeItem;
  changedBy: string;
  changeSummary: string;
}

export interface KnowledgeVersionStore {
  append(input: AppendVersionInput): Promise<KnowledgeVersion>;
  listByKnowledge(
    organizationId: string,
    knowledgeId: string,
  ): Promise<KnowledgeVersion[]>;
  findByVersion(
    organizationId: string,
    knowledgeId: string,
    version: number,
  ): Promise<KnowledgeVersion | null>;
}

export function createKnowledgeVersionStore(db: Db): KnowledgeVersionStore {
  const col = () => db.collection<KnowledgeVersion>("knowledge_versions");

  return {
    async append(input) {
      const record: KnowledgeVersion = {
        id: newKnowledgeVersionId(),
        organizationId: input.organizationId,
        knowledgeId: input.knowledgeId,
        version: input.version,
        snapshot: input.snapshot,
        changedBy: input.changedBy,
        changedAt: new Date().toISOString(),
        changeSummary: input.changeSummary,
      };
      await col().insertOne({ ...record });
      return record;
    },

    async listByKnowledge(organizationId, knowledgeId) {
      return col()
        .find({ organizationId, knowledgeId }, READ_OPTS)
        .sort({ version: 1 })
        .toArray() as Promise<KnowledgeVersion[]>;
    },

    async findByVersion(organizationId, knowledgeId, version) {
      return col().findOne(
        { organizationId, knowledgeId, version },
        READ_OPTS,
      ) as Promise<KnowledgeVersion | null>;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/modules/knowledge-core/version-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/version-repository.ts \
        test/modules/knowledge-core/version-repository.test.ts
git commit -m "feat(pm-012): add KnowledgeVersionStore repository"
```

---

### Task 4: Atomic `version` increment in `KnowledgeItemStore`

Wire `$inc: { version: 1 }` into the existing `update` method so version is
incremented atomically in the DB.

**Files:**
- Modify: `src/modules/knowledge-core/repository.ts`

**Interfaces:**
- Consumes: existing `KnowledgeItemStore.update` signature (unchanged externally)
- Produces: `update` now returns a `KnowledgeItem` whose `version` is already
  incremented (the DB value, not computed in app code)

- [ ] **Step 1: Write failing test**

Add to `test/modules/knowledge-core/` a new file
`knowledge-item-store-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createKnowledgeItemStore } from "../../../src/modules/knowledge-core/repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { KnowledgeItem } from "../../../src/modules/knowledge-core/entities.js";

const orgId = "org_A";

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: "know_ITEM01",
    organizationId: orgId,
    projectId: "proj_A",
    type: "Fact",
    title: "t",
    summary: "s",
    content: { subject: "x", predicate: "is" },
    status: "PUBLISHED",
    version: 1,
    ownerId: "tok_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: null,
    ...overrides,
  };
}

describe("KnowledgeItemStore.update version increment", () => {
  it("increments version atomically on update", async () => {
    const { db } = createFakeDb({ knowledge_items: [makeItem()] });
    const store = createKnowledgeItemStore(db);
    const updated = await store.update(orgId, "know_ITEM01", { title: "new title" });
    expect(updated?.version).toBe(2);
  });

  it("version reaches 4 after three updates", async () => {
    const { db } = createFakeDb({ knowledge_items: [makeItem()] });
    const store = createKnowledgeItemStore(db);
    await store.update(orgId, "know_ITEM01", { title: "a" });
    await store.update(orgId, "know_ITEM01", { title: "b" });
    const final = await store.update(orgId, "know_ITEM01", { title: "c" });
    expect(final?.version).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/modules/knowledge-core/knowledge-item-store-version.test.ts
```

Expected: FAIL — version stays at 1.

- [ ] **Step 3: Add `$inc` to `update` in `repository.ts`**

In `src/modules/knowledge-core/repository.ts`, change the `update` method's
`findOneAndUpdate` call from:

```ts
{ $set: { ...patch, updatedAt: new Date().toISOString() } },
```

to:

```ts
{ $set: { ...patch, updatedAt: new Date().toISOString() }, $inc: { version: 1 } },
```

No other change. The method signature and return type are unchanged.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/modules/knowledge-core/knowledge-item-store-version.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full suite to confirm no regression**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/knowledge-core/repository.ts \
        test/modules/knowledge-core/knowledge-item-store-version.test.ts
git commit -m "feat(pm-012): atomically increment version on KnowledgeItem update"
```

---

### Task 5: Thread version snapshots into `POST` and `PATCH` routes

Extend the existing knowledge routes to write a `KnowledgeVersion` record on
every create and every successful patch. This is where `changeSummary` is
consumed and stripped from the item patch.

**Files:**
- Modify: `src/routes/knowledge.ts`

**Interfaces:**
- Consumes:
  - `createKnowledgeVersionStore` from `../modules/knowledge-core/version-repository.js`
  - `AppendVersionInput` from `../modules/knowledge-core/version-repository.js`
  - `KnowledgeVersion` from `../modules/knowledge-core/version-entities.js`

- [ ] **Step 1: Write failing tests**

Add a new describe block in `test/routes/knowledge.test.ts`:

```ts
import { createKnowledgeVersionStore } from "../../src/modules/knowledge-core/version-repository.js";

// helper — place near top of the file alongside existing helpers
function versionStore(rows: Collections) {
  const { db } = createFakeDb(rows);
  return createKnowledgeVersionStore(db);
}
```

Add at the end of the file:

```ts
describe("versioning — POST /knowledge writes v1", () => {
  it("creates version 1 with changeSummary 'initial version' after POST", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: {
        projectId,
        type: "Fact",
        title: "t",
        summary: "s",
        content: { subject: "x", predicate: "is" },
      },
    });
    expect(res.statusCode).toBe(201);
    const item = res.json();
    expect(item.version).toBe(1);
    const versions = rows.knowledge_versions ?? [];
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].changeSummary).toBe("initial version");
    expect(versions[0].knowledgeId).toBe(item.id);
    await app.close();
  });
});

describe("versioning — PATCH /knowledge/:id writes snapshots", () => {
  it("after 3 patches there are 4 version records (v1 + 3)", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    // create
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: { projectId, type: "Fact", title: "t", summary: "s", content: { subject: "x", predicate: "is" } },
    })).json();
    const id = created.id;
    // 3 patches
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "t2" } });
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "t3" } });
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "t4" } });

    const versions = rows.knowledge_versions ?? [];
    expect(versions).toHaveLength(4);
    const versionNums = versions.map((v: any) => v.version).sort((a: number, b: number) => a - b);
    expect(versionNums).toEqual([1, 2, 3, 4]);
    await app.close();
  });

  it("caller-provided changeSummary is stored verbatim", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: { projectId, type: "Fact", title: "t", summary: "s", content: { subject: "x", predicate: "is" } },
    })).json();
    await app.inject({
      method: "PATCH",
      url: `/knowledge/${created.id}`,
      payload: { title: "t2", changeSummary: "my note" },
    });
    const versions = rows.knowledge_versions ?? [];
    const v2 = versions.find((v: any) => v.version === 2);
    expect(v2?.changeSummary).toBe("my note");
    await app.close();
  });

  it("auto-generates changeSummary from changed fields when not provided", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: { projectId, type: "Fact", title: "t", summary: "s", content: { subject: "x", predicate: "is" } },
    })).json();
    await app.inject({
      method: "PATCH",
      url: `/knowledge/${created.id}`,
      payload: { title: "t2", summary: "s2" },
    });
    const v2 = (rows.knowledge_versions ?? []).find((v: any) => v.version === 2);
    expect(v2?.changeSummary).toBe("changed: title, summary");
    await app.close();
  });

  it("changeSummary is not stored on the KnowledgeItem itself", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: { projectId, type: "Fact", title: "t", summary: "s", content: { subject: "x", predicate: "is" } },
    })).json();
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/knowledge/${created.id}`,
      payload: { title: "t2", changeSummary: "my note" },
    });
    expect(patchRes.json().changeSummary).toBeUndefined();
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/routes/knowledge.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|✗|×"
```

Expected: the four new tests fail (no version records written yet).

- [ ] **Step 3: Update `knowledge.ts` to import version store**

In `src/routes/knowledge.ts`, add imports:

```ts
import {
  createKnowledgeVersionStore,
  type AppendVersionInput,
} from "../modules/knowledge-core/version-repository.js";
```

Add a `vStore` factory alongside `store`:

```ts
const vStore = () => createKnowledgeVersionStore(app.db);
```

- [ ] **Step 4: Thread versioning into `POST /knowledge`**

After `const item = await store().create(...)`, add:

```ts
await vStore().append({
  organizationId: ctx.organizationId,
  knowledgeId: item.id,
  version: item.version,
  snapshot: item,
  changedBy: actor.actorId,
  changeSummary: "initial version",
});
```

- [ ] **Step 5: Thread versioning into `PATCH /knowledge/:id`**

In the PATCH handler, after `const parsed = updateKnowledgeItemBodySchema.safeParse(req.body)`:

Extract and strip `changeSummary`:

```ts
const rawPatch = parsed.data as typeof parsed.data & { changeSummary?: string };
const callerSummary: string | undefined = rawPatch.changeSummary;
const patch = { ...rawPatch } as Omit<typeof rawPatch, "changeSummary">;
delete (patch as Record<string, unknown>).changeSummary;
```

After `const updated = await store().update(...)`:

```ts
const changedFields = Object.keys(patch).filter((k) => k !== "changeSummary");
const changeSummary =
  callerSummary ?? `changed: ${changedFields.join(", ")}`;

await vStore().append({
  organizationId: ctx.organizationId,
  knowledgeId: updated.id,
  version: updated.version,
  snapshot: updated,
  changedBy: actor ? actor.actorId : updated.ownerId,
  changeSummary,
});
```

- [ ] **Step 6: Add `changeSummary` as optional field to `updateKnowledgeItemBodySchema`**

In `src/modules/knowledge-core/entities.ts`, update `updateKnowledgeItemBodySchema`:

```ts
export const updateKnowledgeItemBodySchema = z
  .object({
    title: nonEmpty.optional(),
    summary: nonEmpty.optional(),
    content: z.record(z.unknown()).optional(),
    status: knowledgeStatusSchema.optional(),
    changeSummary: z.string().trim().min(1).optional(),
  })
  .strict();
```

- [ ] **Step 7: Run new tests to verify they pass**

```bash
npx vitest run test/routes/knowledge.test.ts
```

Expected: all tests including the four new ones pass.

- [ ] **Step 8: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/routes/knowledge.ts \
        src/modules/knowledge-core/entities.ts
git commit -m "feat(pm-012): write version snapshots on create and patch"
```

---

### Task 6: Version history endpoints

Add three read-only endpoints:
- `GET /knowledge/:id/versions`
- `GET /knowledge/:id/versions/:v`
- `GET /knowledge/:id/versions/:from/diff/:to`

**Files:**
- Create: `src/routes/knowledge-versions.ts`
- Modify: `src/app.ts` (register the new route file)
- Test: `test/routes/knowledge-versions.test.ts`

**Interfaces:**
- Consumes:
  - `createKnowledgeVersionStore`, `KnowledgeVersionStore` from `../modules/knowledge-core/version-repository.js`
  - `createKnowledgeItemStore` from `../modules/knowledge-core/repository.js`
  - `knowledgeIdSchema` from `../modules/knowledge-core/entities.js`
  - `KnowledgeNotFoundError`, `ValidationError`, `UnauthorizedError` from `../lib/errors.js`
  - `ProjectContext` from `../modules/project-context/context.js`
- Produces:
  - `GET /knowledge/:id/versions` → `{ versions: KnowledgeVersion[] }`
  - `GET /knowledge/:id/versions/:v` → `KnowledgeVersion`
  - `GET /knowledge/:id/versions/:from/diff/:to` →
    `{ from: number, to: number, changes: Record<string, { from: unknown, to: unknown }> }`

**Diff logic:** compare top-level fields of two `snapshot`s. Excluded fields: `updatedAt`, `version`. For each other field, deep-compare; if not strictly equal (use `JSON.stringify` for deep equality), include in `changes`. When `from == to`, return `changes: {}`.

- [ ] **Step 1: Write failing tests**

Create `test/routes/knowledge-versions.test.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerKnowledgeVersionRoutes } from "../../src/routes/knowledge-versions.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb, type Collections } from "../support/fake-db.js";

const orgId = "org_A";
const projectId = newProjectId();
const project = { id: projectId, organizationId: orgId, name: "p", createdAt: "", updatedAt: "" };

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
  return app;
}

const seeded = (extra: Collections = {}): Collections => ({
  projects: [project],
  knowledge_items: [],
  knowledge_versions: [],
  ...extra,
});

// Helper: create an item and patch it n times, return the item id.
async function seedItemWithPatches(app: FastifyInstance, patches: number): Promise<string> {
  const created = (await app.inject({
    method: "POST", url: "/knowledge",
    payload: { projectId, type: "Fact", title: "t0", summary: "s", content: { subject: "x", predicate: "is" } },
  })).json();
  for (let i = 1; i <= patches; i++) {
    await app.inject({ method: "PATCH", url: `/knowledge/${created.id}`, payload: { title: `t${i}` } });
  }
  return created.id;
}

describe("GET /knowledge/:id/versions", () => {
  it("returns 4 versions after create + 3 patches (acceptance criterion)", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 3);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions` });
    expect(res.statusCode).toBe(200);
    const { versions } = res.json();
    expect(versions).toHaveLength(4);
    expect(versions.map((v: any) => v.version)).toEqual([1, 2, 3, 4]);
    await app.close();
  });

  it("returns 404 for unknown item", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const res = await app.inject({ method: "GET", url: "/knowledge/know_00000000000000000000000000/versions" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const { db } = createFakeDb(seeded());
    const app = Fastify({ logger: false });
    app.decorate("db", db);
    app.addHook("onRequest", async (req) => {
      (req as any).projectContext = { organizationId: orgId, projectId: null };
    });
    registerErrorHandler(app);
    registerKnowledgeVersionRoutes(app);
    const res = await app.inject({ method: "GET", url: "/knowledge/know_00000000000000000000000000/versions" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /knowledge/:id/versions/:v", () => {
  it("returns the exact snapshot for a specific version", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 2);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1` });
    expect(res.statusCode).toBe(200);
    const ver = res.json();
    expect(ver.version).toBe(1);
    expect(ver.snapshot.version).toBe(1);
    expect(ver.snapshot.title).toBe("t0"); // original title preserved
    await app.close();
  });

  it("returns 404 for a version number that does not exist", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/99` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for a non-integer version param", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/abc` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /knowledge/:id/versions/:from/diff/:to", () => {
  it("returns only changed fields with from/to values", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    // v1: title=t0, v2: title=t1
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1/diff/2` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.from).toBe(1);
    expect(body.to).toBe(2);
    expect(body.changes.title).toEqual({ from: "t0", to: "t1" });
    expect(body.changes.version).toBeUndefined(); // excluded
    expect(body.changes.updatedAt).toBeUndefined(); // excluded
    await app.close();
  });

  it("returns empty changes when from == to", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1/diff/1` });
    expect(res.statusCode).toBe(200);
    expect(res.json().changes).toEqual({});
    await app.close();
  });

  it("returns 404 if one of the versions does not exist", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1/diff/99` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for non-integer from/to", async () => {
    const rows = seeded();
    const app = buildApp(rows);
    const id = await seedItemWithPatches(app, 1);
    const res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/abc/diff/2` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/routes/knowledge-versions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `knowledge-versions.ts`**

Create `src/routes/knowledge-versions.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { knowledgeIdSchema } from "../modules/knowledge-core/entities.js";
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createKnowledgeVersionStore } from "../modules/knowledge-core/version-repository.js";
import type { KnowledgeItem } from "../modules/knowledge-core/entities.js";
import {
  KnowledgeNotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../lib/errors.js";
import type { ProjectContext } from "../modules/project-context/context.js";

const DIFF_EXCLUDE = new Set(["version", "updatedAt"]);

function diffSnapshots(
  a: KnowledgeItem,
  b: KnowledgeItem,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (DIFF_EXCLUDE.has(key)) continue;
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (JSON.stringify(av) !== JSON.stringify(bv)) {
      changes[key] = { from: av, to: bv };
    }
  }
  return changes;
}

function context(req: FastifyRequest): ProjectContext {
  const ctx = req.projectContext;
  if (!ctx) throw new ValidationError("x-organization-id is missing or malformed");
  return ctx;
}

function parseVersion(raw: string): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) throw new ValidationError("version must be an integer >= 1");
  return v;
}

export function registerKnowledgeVersionRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };
  const store = () => createKnowledgeItemStore(app.db);
  const vStore = () => createKnowledgeVersionStore(app.db);

  // GET /knowledge/:id/versions
  app.get("/knowledge/:id/versions", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);
    const { id } = req.params as { id: string };
    if (!knowledgeIdSchema.safeParse(id).success) throw new ValidationError("knowledge id is malformed");

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const versions = await vStore().listByKnowledge(ctx.organizationId, id);
    return { versions };
  });

  // GET /knowledge/:id/versions/:v
  app.get("/knowledge/:id/versions/:v", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);
    const { id, v } = req.params as { id: string; v: string };
    if (!knowledgeIdSchema.safeParse(id).success) throw new ValidationError("knowledge id is malformed");
    const vNum = parseVersion(v);

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const version = await vStore().findByVersion(ctx.organizationId, id, vNum);
    if (!version) throw new KnowledgeNotFoundError("version not found");
    return version;
  });

  // GET /knowledge/:id/versions/:from/diff/:to
  app.get("/knowledge/:id/versions/:from/diff/:to", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const ctx = context(req);
    const { id, from, to } = req.params as { id: string; from: string; to: string };
    if (!knowledgeIdSchema.safeParse(id).success) throw new ValidationError("knowledge id is malformed");
    const fromNum = parseVersion(from);
    const toNum = parseVersion(to);

    const item = await store().findById(ctx.organizationId, id);
    if (!item) throw new KnowledgeNotFoundError();

    const [vFrom, vTo] = await Promise.all([
      vStore().findByVersion(ctx.organizationId, id, fromNum),
      vStore().findByVersion(ctx.organizationId, id, toNum),
    ]);
    if (!vFrom || !vTo) throw new KnowledgeNotFoundError("one or both versions not found");

    return {
      from: fromNum,
      to: toNum,
      changes: diffSnapshots(vFrom.snapshot, vTo.snapshot),
    };
  });
}
```

- [ ] **Step 4: Register routes in `src/app.ts`**

In `src/app.ts`, add import and registration:

```ts
import { registerKnowledgeVersionRoutes } from "./routes/knowledge-versions.js";
```

After the existing `registerKnowledgeRoutes(app)` call:

```ts
registerKnowledgeVersionRoutes(app);
```

- [ ] **Step 5: Run new tests to verify they pass**

```bash
npx vitest run test/routes/knowledge-versions.test.ts
```

Expected: PASS — all version endpoint tests green.

- [ ] **Step 6: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/knowledge-versions.ts \
        src/app.ts \
        test/routes/knowledge-versions.test.ts
git commit -m "feat(pm-012): add version history and diff endpoints"
```

---

### Task 7: E2E smoke test for the acceptance criterion

A focused end-to-end test that wires up the full real-Fastify app (with fake DB)
and walks through the exact acceptance scenario from the issue: 3 updates → 4
versions.

**Files:**
- Create: `test/routes/knowledge-versioning-e2e.test.ts`

**Interfaces:**
- Consumes: `buildApp` pattern from `knowledge-e2e.test.ts`; all routes registered.

- [ ] **Step 1: Write the e2e test**

Create `test/routes/knowledge-versioning-e2e.test.ts`:

```ts
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerKnowledgeRoutes } from "../../src/routes/knowledge.js";
import { registerKnowledgeVersionRoutes } from "../../src/routes/knowledge-versions.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newProjectId } from "../../src/modules/project-context/entities.js";
import { createFakeDb } from "../support/fake-db.js";

const orgId = "org_E2E";
const projectId = newProjectId();

function buildApp() {
  const rows = {
    projects: [{ id: projectId, organizationId: orgId, name: "e2e", createdAt: "", updatedAt: "" }],
    knowledge_items: [] as any[],
    knowledge_versions: [] as any[],
  };
  const { db } = createFakeDb(rows);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => {
    const r = req as any;
    r.actor = { actorId: "tok_e2e", organizationId: orgId, type: "service" };
    r.projectContext = { organizationId: orgId, projectId: null };
  });
  registerErrorHandler(app);
  registerKnowledgeRoutes(app);
  registerKnowledgeVersionRoutes(app);
  return app;
}

describe("Knowledge versioning — acceptance criterion", () => {
  it("3 updates produce 4 version entries and each snapshot is retrievable", async () => {
    const app = buildApp();

    // Create item — v1
    const created = (await app.inject({
      method: "POST", url: "/knowledge",
      payload: {
        projectId, type: "Fact", title: "original", summary: "s",
        content: { subject: "x", predicate: "is" },
      },
    })).json();
    expect(created.version).toBe(1);
    const id = created.id;

    // Patch 1 — v2
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "update-1", changeSummary: "first edit" } });
    // Patch 2 — v3
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { summary: "updated summary" } });
    // Patch 3 — v4
    await app.inject({ method: "PATCH", url: `/knowledge/${id}`, payload: { title: "update-3" } });

    // List — must have 4 entries
    const listRes = await app.inject({ method: "GET", url: `/knowledge/${id}/versions` });
    expect(listRes.statusCode).toBe(200);
    const { versions } = listRes.json();
    expect(versions).toHaveLength(4);
    expect(versions.map((v: any) => v.version)).toEqual([1, 2, 3, 4]);

    // v1 snapshot preserved original title
    const v1Res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1` });
    expect(v1Res.json().snapshot.title).toBe("original");

    // v2 has caller changeSummary
    const v2Res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/2` });
    expect(v2Res.json().changeSummary).toBe("first edit");

    // v3 auto-generated changeSummary
    const v3Res = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/3` });
    expect(v3Res.json().changeSummary).toBe("changed: summary");

    // diff v1 → v3 shows title and summary changed
    const diffRes = await app.inject({ method: "GET", url: `/knowledge/${id}/versions/1/diff/3` });
    expect(diffRes.statusCode).toBe(200);
    const diff = diffRes.json();
    expect(diff.changes.title).toBeDefined();
    expect(diff.changes.summary).toBeDefined();
    expect(diff.changes.version).toBeUndefined();

    await app.close();
  });
});
```

- [ ] **Step 2: Run e2e test**

```bash
npx vitest run test/routes/knowledge-versioning-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full suite one final time**

```bash
npx vitest run
```

Expected: all tests pass, no regressions.

- [ ] **Step 4: Commit**

```bash
git add test/routes/knowledge-versioning-e2e.test.ts
git commit -m "test(pm-012): e2e acceptance test for knowledge versioning"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `KnowledgeVersion` collection + entity | Task 2, 3 |
| On every approved update: increment `version`, write snapshot | Task 4, 5 |
| v1 written at create | Task 5 |
| `GET /knowledge/:id/versions` | Task 6 |
| `GET /knowledge/:id/versions/:v` | Task 6 |
| Diff between two versions | Task 6 |
| Version monotonically increasing, never reused | Task 4 (`$inc` in DB) |
| After 3 updates → 4 entries (acceptance criterion) | Task 6 test, Task 7 |
| Snapshot = exact state at that version | Task 6 test (v1 title check) |
| `changeSummary`: caller \| auto-generated \| "initial version" | Task 5 |
| `from == to → changes: {}` | Task 6 test |
| Tenant scope on version queries | Task 3 test |
| `ponytail:` atomicity note | In spec; no transaction, noted in Task 4 |
| Fake DB `$inc` and `sort` gaps | Task 1 |

**Placeholder scan:** no TBD, TODO, or "similar to Task N" — all code is fully written.

**Type consistency:**
- `AppendVersionInput` defined in Task 3, consumed in Task 5 ✓
- `createKnowledgeVersionStore` defined in Task 3, used in Task 5 and Task 6 ✓
- `registerKnowledgeVersionRoutes` defined in Task 6, registered in `app.ts` in Task 6 ✓
- `newKnowledgeVersionId` defined in Task 2, used in Task 3 ✓
- `changeSummary` added to `updateKnowledgeItemBodySchema` in Task 5, consumed in Task 5 ✓
