# Typed Knowledge Contracts (PM-011) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-type content contracts on the knowledge write path and make `Fact` the seventh `KnowledgeItem` type.

**Architecture:** Author seven `.strict()` Zod content schemas in a new `knowledge-core/contracts.ts` file, exposed through a `type → schema` lookup map and a `validateContent(type, content)` helper. The POST and PATCH `/knowledge` routes call this helper as a second validation step after the existing raw-body parse. Zod is the single source of truth; the stale `specs/knowledge/*.json` files are deleted.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod 3.23.8, Fastify 5, Vitest 2, MongoDB driver 7 (via an in-memory fake DB in tests).

**Spec:** `docs/superpowers/specs/2026-09-21-pm-011-typed-knowledge-contracts-design.md`

## Global Constraints

- Node `>=20.19.0`; ESM project (`"type": "module"`) — all relative imports use `.js` extensions even for `.ts` sources.
- Zod pinned at `3.23.8`; no new dependencies.
- All content string fields use the `nonEmpty` rule: `z.string().trim().min(1)`.
- Every content schema is `.strict()` — unknown fields are rejected.
- Multi-word content fields use camelCase (`relatedConcepts`, `failureHandling`).
- Contract violations throw `ValidationError` (400, code `VALIDATION_ERROR`); unknown `type` keeps throwing `InvalidKnowledgeTypeError` (422). No new error class.
- Verification command for the whole plan: `npm run check` (lint + typecheck + test).

---

### Task 1: Add `Fact` as the seventh knowledge type

**Files:**
- Modify: `src/modules/knowledge-core/entities.ts` (the `KNOWLEDGE_TYPES` array)
- Test: `test/modules/knowledge-core/entities.test.ts` (create if absent; otherwise add a case)

**Interfaces:**
- Consumes: nothing new.
- Produces: `KNOWLEDGE_TYPES` now includes `"Fact"`; `KnowledgeType` union gains `"Fact"`; `knowledgeTypeSchema` (`z.enum(KNOWLEDGE_TYPES)`) accepts `"Fact"`.

- [ ] **Step 1: Write the failing test**

Create `test/modules/knowledge-core/entities.test.ts` (or append the `it` block if the file already exists):

```ts
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_TYPES, knowledgeTypeSchema } from "../../../src/modules/knowledge-core/entities.js";

describe("KNOWLEDGE_TYPES", () => {
  it("includes all seven knowledge types with Fact", () => {
    expect(KNOWLEDGE_TYPES).toEqual([
      "Decision",
      "Concept",
      "Procedure",
      "Troubleshooting",
      "Investigation",
      "Architecture",
      "Fact",
    ]);
    expect(knowledgeTypeSchema.safeParse("Fact").success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/entities.test.ts`
Expected: FAIL — array does not contain `"Fact"`.

- [ ] **Step 3: Add `"Fact"` to the array**

In `src/modules/knowledge-core/entities.ts`, change the `KNOWLEDGE_TYPES` declaration to:

```ts
export const KNOWLEDGE_TYPES = [
  "Decision",
  "Concept",
  "Procedure",
  "Troubleshooting",
  "Investigation",
  "Architecture",
  "Fact",
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/entities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/entities.ts test/modules/knowledge-core/entities.test.ts
git commit -m "feat(pm-011): add Fact as the seventh knowledge type"
```

---

### Task 2: Content contracts module and `validateContent`

**Files:**
- Create: `src/modules/knowledge-core/contracts.ts`
- Test: `test/modules/knowledge-core/contracts.test.ts`

**Interfaces:**
- Consumes: `KnowledgeType`, `KNOWLEDGE_TYPES` from `./entities.js`; `ValidationError` from `../../lib/errors.js`.
- Produces:
  - `CONTENT_SCHEMAS: Record<KnowledgeType, z.ZodTypeAny>` — one `.strict()` schema per type.
  - `validateContent(type: KnowledgeType, content: unknown): Record<string, unknown>` — returns parsed/normalized content, or throws `ValidationError("invalid content for type <Type>: <detail>")`.

- [ ] **Step 1: Write the failing test**

Create `test/modules/knowledge-core/contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateContent, CONTENT_SCHEMAS } from "../../../src/modules/knowledge-core/contracts.js";
import { KNOWLEDGE_TYPES } from "../../../src/modules/knowledge-core/entities.js";
import { ValidationError } from "../../../src/lib/errors.js";

const validSamples: Record<string, Record<string, unknown>> = {
  Decision: { context: "c", problem: "p", decision: "d" },
  Concept: { definition: "d" },
  Procedure: { purpose: "p", steps: ["one"] },
  Troubleshooting: { symptoms: "s", cause: "c", resolution: "r" },
  Investigation: { question: "q" },
  Architecture: { component: "c", responsibility: "r" },
  Fact: { subject: "s", predicate: "p" },
};

describe("CONTENT_SCHEMAS", () => {
  it("has a schema for every knowledge type", () => {
    for (const type of KNOWLEDGE_TYPES) {
      expect(CONTENT_SCHEMAS[type]).toBeDefined();
    }
  });
});

describe("validateContent", () => {
  it("accepts minimal valid content for each type", () => {
    for (const type of KNOWLEDGE_TYPES) {
      const sample = validSamples[type];
      expect(validateContent(type, sample)).toEqual(sample);
    }
  });

  it("throws ValidationError when a required field is missing", () => {
    expect(() => validateContent("Decision", { context: "c", problem: "p" })).toThrow(ValidationError);
  });

  it("throws ValidationError on an unknown field (strict)", () => {
    expect(() => validateContent("Concept", { definition: "d", bogus: "x" })).toThrow(ValidationError);
  });

  it("names the type in the error message", () => {
    expect(() => validateContent("Decision", {})).toThrow(/Decision/);
  });

  it("trims string fields and strips nothing extra", () => {
    expect(validateContent("Concept", { definition: "  hi  " })).toEqual({ definition: "hi" });
  });

  it("accepts an arbitrary object value on a Fact", () => {
    const c = { subject: "s", predicate: "p", object: { nested: 1 } };
    expect(validateContent("Fact", c)).toEqual(c);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/knowledge-core/contracts.test.ts`
Expected: FAIL — cannot resolve `../../../src/modules/knowledge-core/contracts.js`.

- [ ] **Step 3: Create the contracts module**

Create `src/modules/knowledge-core/contracts.ts`:

```ts
import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import type { KnowledgeType } from "./entities.js";

const nonEmpty = z.string().trim().min(1);
const nonEmptyList = z.array(nonEmpty);

const decision = z
  .object({
    context: nonEmpty,
    problem: nonEmpty,
    decision: nonEmpty,
    alternatives: nonEmptyList.optional(),
    consequences: nonEmpty.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const concept = z
  .object({
    definition: nonEmpty,
    responsibility: nonEmpty.optional(),
    boundaries: nonEmpty.optional(),
    relatedConcepts: nonEmptyList.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const procedure = z
  .object({
    purpose: nonEmpty,
    steps: nonEmptyList,
    prerequisites: nonEmptyList.optional(),
    verification: nonEmpty.optional(),
    failureHandling: nonEmpty.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const troubleshooting = z
  .object({
    symptoms: nonEmpty,
    cause: nonEmpty,
    resolution: nonEmpty,
    diagnosis: nonEmpty.optional(),
    verification: nonEmpty.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const investigation = z
  .object({
    question: nonEmpty,
    observations: nonEmptyList.optional(),
    hypotheses: nonEmptyList.optional(),
    findings: nonEmpty.optional(),
    conclusion: nonEmpty.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const architecture = z
  .object({
    component: nonEmpty,
    responsibility: nonEmpty,
    dependencies: nonEmptyList.optional(),
    interfaces: nonEmptyList.optional(),
    constraints: nonEmptyList.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const fact = z
  .object({
    subject: nonEmpty,
    predicate: nonEmpty,
    object: z.unknown().optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

export const CONTENT_SCHEMAS: Record<KnowledgeType, z.ZodTypeAny> = {
  Decision: decision,
  Concept: concept,
  Procedure: procedure,
  Troubleshooting: troubleshooting,
  Investigation: investigation,
  Architecture: architecture,
  Fact: fact,
};

function describeIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((i) => {
      const path = i.path.join(".") || "(root)";
      return `${path}: ${i.message}`;
    })
    .join("; ");
}

export function validateContent(
  type: KnowledgeType,
  content: unknown,
): Record<string, unknown> {
  const result = CONTENT_SCHEMAS[type].safeParse(content);
  if (!result.success) {
    throw new ValidationError(
      `invalid content for type ${type}: ${describeIssues(result.error.issues)}`,
    );
  }
  return result.data as Record<string, unknown>;
}
```

Note on the `object` field: `z.unknown().optional()` keeps the key when present (including explicit `undefined` is dropped by Zod's strip, but any concrete value — object, string, number — is preserved), matching the old JSON Schema's untyped `object`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/knowledge-core/contracts.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/knowledge-core/contracts.ts test/modules/knowledge-core/contracts.test.ts
git commit -m "feat(pm-011): add per-type content contracts and validateContent"
```

---

### Task 3: Enforce contracts on the POST route

**Files:**
- Modify: `src/routes/knowledge.ts` (the `app.post("/knowledge", ...)` handler)
- Test: `test/routes/knowledge.test.ts` (extend the `POST /knowledge` describe block, and fix existing payloads)

**Interfaces:**
- Consumes: `validateContent` from `../modules/knowledge-core/contracts.js`.
- Produces: POST rejects content that violates its type's contract with 400; a valid `Fact` create returns 201.

- [ ] **Step 1: Fix existing POST tests broken by contract enforcement, then add new cases**

The existing POST tests send `type: "Decision"` with no content and rely on empty `{}` content passing. That no longer holds. Make these exact edits in `test/routes/knowledge.test.ts`:

1. The test **"creates a 201 item with defaults and server-derived owner"** — add valid Decision content to the payload and update the content assertion:

```ts
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: {
        projectId, type: "Decision", title: "t", summary: "s",
        content: { context: "c", problem: "p", decision: "d" },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body._id).toBeUndefined();
    expect(body.id).toMatch(/^know_/);
    expect(body.status).toBe("DISCOVERED");
    expect(body.content).toEqual({ context: "c", problem: "p", decision: "d" });
```

2. In every other POST test whose payload uses `type: "Decision"` **and expects a non-validation outcome** — i.e. "accepts PROPOSED as an explicit initial status", "returns 404 for a project outside the org", "rejects a malformed projectId with 400" (this one expects 400 already, but the 400 must come from the projectId check, not content — see note below), and "returns 400 when there is no organization context" — add the same content object to the payload:

```ts
      content: { context: "c", problem: "p", decision: "d" },
```

   Note on ordering: the route validates content **after** `type`/status/body/projectId checks, so the "malformed projectId" and "no organization context" and "non-initial status" tests still fail on their intended check before content is reached. Adding valid content is belt-and-suspenders and keeps intent clear. The "rejects a missing type with 400" and "rejects a missing projectId with 400" tests need **no** content (they fail before content validation); leave them as-is.

3. The test **"rejects an unknown type with 422"** currently uses `type: "Fact"`. `Fact` is now valid, so change the type to a genuinely unknown one:

```ts
      payload: { projectId, type: "Bogus", title: "t", summary: "s" },
```

- [ ] **Step 2: Add the new failing tests**

Append to the `POST /knowledge` describe block in `test/routes/knowledge.test.ts`:

```ts
  it("rejects content that violates its type contract with 400", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: {
        projectId, type: "Decision", title: "t", summary: "s",
        content: { context: "c" },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("creates a valid Fact (the seventh type) with 201", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: {
        projectId, type: "Fact", title: "t", summary: "s",
        content: { subject: "a", predicate: "depends_on", object: "b" },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("Fact");
    expect(res.json().content).toEqual({ subject: "a", predicate: "depends_on", object: "b" });
    await app.close();
  });

  it("rejects an empty content object for a type that requires fields", async () => {
    const app = buildApp(seeded());
    const res = await app.inject({
      method: "POST",
      url: "/knowledge",
      payload: { projectId, type: "Decision", title: "t", summary: "s", content: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run test/routes/knowledge.test.ts`
Expected: the three new tests FAIL (content is not yet validated, so the invalid-content and empty-content cases return 201 instead of 400); the Fact case may already pass after Task 1. Existing edited tests should pass.

- [ ] **Step 4: Add content validation to the POST handler**

In `src/routes/knowledge.ts`, add the import near the other knowledge-core imports:

```ts
import { validateContent } from "../modules/knowledge-core/contracts.js";
```

Then in the `app.post("/knowledge", ...)` handler, after `await requireProject(...)` and before `const item = await store().create({`, insert:

```ts
    const content = validateContent(body.type, body.content);
```

and change the `create` call to use the validated content:

```ts
    const item = await store().create({
      organizationId: ctx.organizationId,
      projectId: body.projectId,
      type: body.type,
      title: body.title,
      summary: body.summary,
      content,
      status: body.status ?? "DISCOVERED",
      ownerId: actor.actorId,
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/routes/knowledge.test.ts`
Expected: PASS (all POST tests, old and new).

- [ ] **Step 6: Commit**

```bash
git add src/routes/knowledge.ts test/routes/knowledge.test.ts
git commit -m "feat(pm-011): validate content by type on knowledge create"
```

---

### Task 4: Enforce contracts on PATCH, and fix the Fact filter test

**Files:**
- Modify: `src/routes/knowledge.ts` (the `app.patch("/knowledge/:id", ...)` handler)
- Test: `test/routes/knowledge.test.ts` (extend the `PATCH /knowledge/:id` block; fix the `GET /knowledge` Fact-filter assertion)

**Interfaces:**
- Consumes: `validateContent` (already imported in Task 3), `existing.type` from the loaded item.
- Produces: PATCH with `content` validates the new content against the item's existing `type`; invalid content → 400.

- [ ] **Step 1: Fix the GET Fact-filter test broken by Task 1**

In the `GET /knowledge` test **"lists with project, type and status filters"**, the assertion using `type=Fact` expected a 400 because `Fact` was not a valid type. `Fact` is now valid, so that request would return 200 with an empty list. Change the bad-type filter to a genuinely invalid value:

```ts
    const badType = await app.inject({ method: "GET", url: "/knowledge?type=Bogus" });
    expect(badType.statusCode).toBe(400);
    expect(badType.json().error.code).toBe("VALIDATION_ERROR");
```

- [ ] **Step 2: Write the failing PATCH tests**

Append to the `PATCH /knowledge/:id` describe block in `test/routes/knowledge.test.ts` (the block already defines `published` with `type: "Decision"`):

```ts
  it("validates replacement content against the item's existing type", async () => {
    const item = { ...published, status: "DISCOVERED", content: { context: "c", problem: "p", decision: "d" } };
    const app = buildApp({ projects: [project], knowledge_items: [item] });
    const res = await app.inject({
      method: "PATCH",
      url: `/knowledge/${item.id}`,
      payload: { content: { context: "only-context" } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("accepts valid replacement content and returns it", async () => {
    const item = { ...published, status: "DISCOVERED", content: { context: "c", problem: "p", decision: "d" } };
    const app = buildApp({ projects: [project], knowledge_items: [item] });
    const next = { context: "c2", problem: "p2", decision: "d2" };
    const res = await app.inject({
      method: "PATCH",
      url: `/knowledge/${item.id}`,
      payload: { content: next },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toEqual(next);
    await app.close();
  });
```

- [ ] **Step 3: Run tests to verify the new PATCH tests fail**

Run: `npx vitest run test/routes/knowledge.test.ts`
Expected: "validates replacement content..." FAILs (invalid content currently returns 200). "accepts valid replacement content..." likely PASSes already. The GET filter edit passes.

- [ ] **Step 4: Add content validation to the PATCH handler**

In `src/routes/knowledge.ts`, in the `app.patch("/knowledge/:id", ...)` handler, after the existing-item load and the status-transition check, and before `const updated = await store().update(...)`, insert:

```ts
    if (patch.content !== undefined) {
      patch.content = validateContent(existing.type, patch.content);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/routes/knowledge.test.ts`
Expected: PASS (all PATCH tests, old and new).

- [ ] **Step 6: Commit**

```bash
git add src/routes/knowledge.ts test/routes/knowledge.test.ts
git commit -m "feat(pm-011): validate replacement content on knowledge patch"
```

---

### Task 5: Delete the stale JSON Schema files and verify the full suite

**Files:**
- Delete: `specs/knowledge/fact.schema.json`, `specs/knowledge/decision.schema.json`, `specs/knowledge/concept.schema.json`

**Interfaces:**
- Consumes: nothing.
- Produces: no runtime effect — these files are not loaded by the service. Removing them eliminates the drifting second source of truth.

- [ ] **Step 1: Confirm the files are not imported anywhere**

Run: `grep -rn "specs/knowledge" src test scripts`
Expected: no source or test references (the spec-validation CI globs JSON generically; deleting three files leaves it valid). If any reference exists, stop and report — the deletion assumption is wrong.

- [ ] **Step 2: Delete the three files**

```bash
git rm specs/knowledge/fact.schema.json specs/knowledge/decision.schema.json specs/knowledge/concept.schema.json
```

- [ ] **Step 3: Run the spec validation script**

Run: `python scripts/validate-json.py` (or the command referenced by `.github/workflows/validate-specs.yml` — check that file for the exact invocation)
Expected: reports remaining JSON specs valid; no error about the deleted files.

- [ ] **Step 4: Run the full check suite**

Run: `npm run check`
Expected: PASS — lint, typecheck, and all tests green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(pm-011): remove stale non-authoritative knowledge JSON schemas"
```

---

## Self-Review

**Spec coverage:**
- Goal "enforce per-type contracts on write path" → Tasks 3 (POST), 4 (PATCH). ✔
- Goal "Fact as 7th type" → Task 1, plus Fact create test in Task 3. ✔
- Goal "Zod single source of truth in knowledge-core" → Task 2 (`contracts.ts`). ✔
- Goal "remove stale specs/knowledge/*.json" → Task 5. ✔
- Decision "strict + required from docs" → Task 2 schemas match the spec's contracts table. ✔
- Decision "lookup map not discriminated union" → `CONTENT_SCHEMAS` map in Task 2. ✔
- Decision "PATCH replaces wholesale, validated against existing type" → Task 4 step 4. ✔
- Decision "reuse ValidationError with type+field message" → `validateContent` in Task 2. ✔
- Data-flow ordering (type check → body parse → projectId → content) → preserved in Task 3 (content inserted after `requireProject`). ✔
- Testing section (per-type contract tests; POST invalid→400, Fact→201; PATCH invalid→400) → Tasks 2, 3, 4. ✔

**Placeholder scan:** No TBD/TODO; every code step has concrete code; no "similar to Task N" references. ✔

**Type consistency:** `validateContent(type, content)` and `CONTENT_SCHEMAS` names are identical across Tasks 2, 3, 4. Content field names match the spec's contracts table (camelCase `relatedConcepts`, `failureHandling`). `KNOWLEDGE_TYPES` seven-element order in Task 1 matches the array asserted in Task 1's test and the `CONTENT_SCHEMAS` keys in Task 2. ✔

**Regression coverage:** Task 3 and Task 4 explicitly enumerate the pre-existing tests that break (Decision-with-empty-content POSTs, the `type: "Fact"` 422 test, the `type=Fact` GET-filter 400 test) and how to fix each. ✔
