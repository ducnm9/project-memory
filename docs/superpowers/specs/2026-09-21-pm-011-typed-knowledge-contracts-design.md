# PM-011 — Typed Knowledge Contracts — Design

Status: Approved (design)
Date: 2026-09-21
Epic: 2 — Knowledge Core
Depends on: PM-010 (KnowledgeItem base model and CRUD)

## Problem

PM-010 established the `KnowledgeItem` base model and CRUD routes, but its
`content` field is an untyped `Record<string, unknown>` — any object is
accepted. The domain model defines seven knowledge types, each with its own
content contract (Decision, Concept, Procedure, Troubleshooting,
Investigation, Architecture, Fact). Without enforcement, nothing stops a
`Decision` item from being stored with the fields of a `Concept`, or with
typos in field names, which corrupts downstream retrieval and evidence.

Two secondary inconsistencies exist today:

- `KNOWLEDGE_TYPES` in `src/modules/knowledge-core/entities.ts` lists only six
  types — `Fact` is missing — while the domain docs and this workspace name
  describe seven.
- `specs/knowledge/*.json` contains three hand-written JSON Schema files
  (fact, decision, concept) that are incomplete (3 of 7) and not consumed by
  the running service, creating a second, drifting source of truth.

## Goals

- Enforce per-type content contracts on the knowledge write path (POST/PATCH).
- Make `Fact` the seventh `KnowledgeItem` type with its own content contract.
- Establish a single source of truth for content contracts: Zod, in
  `knowledge-core`.
- Remove the stale, non-authoritative `specs/knowledge/*.json` files.

## Non-goals

- The separate subject/predicate/object `Fact` entity with its own storage and
  relation semantics (deferred to PM-014). Here `Fact` is only a
  `KnowledgeItem` content type.
- Versioning, provenance, relations (PM-012–PM-016).
- Publishing JSON Schema artifacts for external consumers. If needed later,
  they can be generated from the Zod contracts; not part of this change.
- Deep-merge semantics for PATCH content. Content is replaced wholesale,
  matching the existing `$set` behaviour.

## Decisions

1. **`Fact` is the 7th KnowledgeItem type.** Add `"Fact"` to `KNOWLEDGE_TYPES`.
2. **Zod is the single source of truth** for content contracts, authored in
   `knowledge-core`. The `specs/knowledge/*.json` files are deleted.
3. **Strict validation.** Each content schema uses `.strict()` — unknown
   fields are rejected — consistent with the existing body schemas. Required
   fields follow the domain docs (see contracts table).
4. **Lookup map, not discriminated union.** A `type → contentSchema` map is
   used so both POST (type in body) and PATCH (type looked up from the existing
   item) share one validation path.
5. **PATCH content replaces wholesale** and is validated against the existing
   item's current `type`; the new content must satisfy the full contract.
6. **Reuse `ValidationError` (400)** for contract violations, with a message
   naming the type and the offending field(s). No new error class.

## Architecture

New file `src/modules/knowledge-core/contracts.ts`:

- Seven `.strict()` Zod content schemas, one per knowledge type.
- `CONTENT_SCHEMAS: Record<KnowledgeType, ZodType>` — lookup by type.
- `validateContent(type, content): Record<string, unknown>` — parses content
  against the type's schema; on failure throws
  `ValidationError("invalid content for type <Type>: <field detail>")`; on
  success returns the parsed (trimmed, stripped) data.

Rationale for a separate file: `entities.ts` owns the `KnowledgeItem` shape and
body/lifecycle schemas; `contracts.ts` owns per-type content semantics. Two
distinct responsibilities, and seven schemas would bloat `entities.ts`.

Changed files:

- `src/modules/knowledge-core/entities.ts` — add `"Fact"` to `KNOWLEDGE_TYPES`.
  The `content` field in `createKnowledgeItemBodySchema` /
  `updateKnowledgeItemBodySchema` stays `z.record(z.unknown())` (raw shape
  gate); per-type validation is a separate step via `validateContent`.
- `src/routes/knowledge.ts` — call `validateContent` on POST and PATCH.
- `specs/knowledge/fact.schema.json`, `decision.schema.json`,
  `concept.schema.json` — deleted.

## Content contracts

All string fields use the existing `nonEmpty` rule (trimmed, min length 1).
Multi-word fields use camelCase for consistency with the TS codebase.

| Type | Required | Optional |
|------|----------|----------|
| Decision | `context`, `problem`, `decision` | `alternatives: string[]`, `consequences: string`, `evidence: string[]` |
| Concept | `definition` | `responsibility`, `boundaries`, `relatedConcepts: string[]`, `evidence: string[]` |
| Procedure | `purpose`, `steps: string[]` | `prerequisites: string[]`, `verification: string`, `failureHandling: string`, `evidence: string[]` |
| Troubleshooting | `symptoms`, `cause`, `resolution` | `diagnosis: string`, `verification: string`, `evidence: string[]` |
| Investigation | `question` | `observations: string[]`, `hypotheses: string[]`, `findings: string`, `conclusion: string`, `evidence: string[]` |
| Architecture | `component`, `responsibility` | `dependencies: string[]`, `interfaces: string[]`, `constraints: string[]`, `evidence: string[]` |
| Fact | `subject`, `predicate` | `object` (any type), `evidence: string[]` |

Required-field notes:

- Decision, Concept, Fact required sets are taken verbatim from the existing
  `specs/knowledge/*.json` files.
- Procedure, Troubleshooting, Investigation, Architecture: the domain docs list
  fields without marking required. Required = the fields without which the
  record is meaningless (a procedure with no `purpose`+`steps`, a
  troubleshooting with no `symptoms`+`cause`+`resolution`, an investigation
  with no `question`, an architecture with no `component`+`responsibility`).
  Everything else is optional.
- `Fact.object` accepts any type (`z.unknown()` / `z.any()`), matching the old
  JSON Schema's untyped `object` (`{}`).

## Data flow

POST /knowledge:

1. Existing raw checks: `type` in the 7 types (else `InvalidKnowledgeTypeError`,
   422), initial status valid.
2. Parse `createKnowledgeItemBodySchema` (raw content shape gate).
3. `body.content = validateContent(body.type, body.content)`.
4. `store().create(...)`.

PATCH /knowledge/:id:

1. Parse `updateKnowledgeItemBodySchema`.
2. Load `existing`; 404 if absent.
3. Status transition check (unchanged).
4. If `patch.content !== undefined`:
   `patch.content = validateContent(existing.type, patch.content)`.
5. `store().update(...)`.

## Error handling

- `type` not one of the 7 → `InvalidKnowledgeTypeError` (422), unchanged.
- `type` valid but content violates its contract → `ValidationError` (400),
  message names the type and the offending field(s), derived from
  `result.error.issues`.

## Testing

- `test/modules/knowledge-core/contracts.test.ts` (new): for each of the 7
  types — a valid content passes; a missing required field throws; an unknown
  field throws (`.strict()`); `validateContent` returns trimmed/stripped data.
  This is the required runnable check for the new logic.
- `test/routes/knowledge.test.ts` (extend): POST with content invalid for its
  type → 400; POST a valid `Fact` (the 7th type) → 201; PATCH with content
  invalid for the item's existing type → 400.

## Verification

Run `npm run check` (lint + typecheck + test). Fix any failures before
claiming completion. No temporary files left behind.
