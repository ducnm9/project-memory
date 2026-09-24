# Governance, Conflict Resolution, Freshness Detection & MCP Server Foundation
## Design Spec — Issues #32–#36 (PM-044, PM-045, PM-046, PM-047, PM-050)

**Date:** 2026-09-24  
**Issues:** [PM-044] Freshness detection, [PM-045] Proposal lifecycle management, [PM-046] Human review interface, [PM-047] Conflict resolution workflow, [PM-050] MCP server foundation  
**Stack:** Fastify 5 · MongoDB · Zod · Vitest · MCP TypeScript SDK

---

## 1. Overview

Five related features that complete the governance layer and open the agent interface:

| Issue | Feature | Depends on |
|-------|---------|------------|
| PM-044 | Freshness detection | IncrementalSync (exists) |
| PM-045 | Proposal lifecycle (full FSM) | Auth roles (this spec) |
| PM-046 | Human review API | PM-045 |
| PM-047 | Conflict resolution | PM-045 |
| PM-050 | MCP server foundation | PM-045, PM-046 |

**Key decision:** `KnowledgeProposal` (in `src/modules/ingestion/`) is fully replaced by a richer `Proposal` entity in `src/modules/governance/`. All existing proposal routes are rewritten.

---

## 2. Data Models

### 2.1 Auth — Roles on ServiceToken

Add `role` to `ServiceToken`:

```ts
type PrincipalRole = "ADMIN" | "REVIEWER" | "READER";

interface ServiceToken {
  // existing fields unchanged
  id: string;              // "tok_<ULID>"
  organizationId: string;
  name: string;
  hashedToken: string;
  createdAt: string;
  // new field
  role: PrincipalRole;     // default: "READER"
}
```

- Admin key (`Authorization: Bearer <ADMIN_KEY>`) → implicit `ADMIN`.
- New tokens get `READER` unless `role` is specified at creation time.
- `req.principal.role` is set by the auth plugin and consumed by a `requireRole()` guard in routes.

### 2.2 Proposal (replaces KnowledgeProposal)

```ts
type ProposalStatus =
  | "PROPOSED"
  | "VALIDATING"
  | "ACCEPTED"
  | "PUBLISHED"
  | "REJECTED"
  | "CHANGES_REQUESTED";

interface ValidationResult {
  checkType: "structural" | "duplicate" | "contradiction";
  status: "PASS" | "FAIL" | "WARN";
  message: string;
  details?: unknown;
}

interface Proposal {
  id: string;                           // "prop_<ULID>"
  organizationId: string;
  projectId: string;
  knowledgeItemId: string | null;       // null = new item; set = update to existing
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status: ProposalStatus;
  proposedBy: string;                   // actorId from request context
  proposedAt: string;                   // ISO 8601
  validationResults: ValidationResult[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  changesFeedback: string | null;       // populated on CHANGES_REQUESTED
  sourceIds: string[];
  contentHash: string;                  // SHA-256(type + ":" + title + ":" + summary) — dedup key
  triggeredBy: "bootstrap" | "incremental" | "manual";
  createdAt: string;
  updatedAt: string;
}
```

**FSM:**
```
PROPOSED → VALIDATING → ACCEPTED → PUBLISHED
                      ↘ REJECTED
                      ↘ CHANGES_REQUESTED
```
- Create lands in `VALIDATING` immediately (validation runs synchronously on create).
- Hard duplicate (cosine ≥ 0.92 or exact title match) → 409, no record created.
- `REJECTED` and `CHANGES_REQUESTED` are terminal — cannot be re-approved without re-creating.
- `approve` with optional `content` edit: transitions `VALIDATING → ACCEPTED → PUBLISHED` atomically.

### 2.3 ConflictRecord (new)

```ts
type ConflictResolution = "KEEP_EXISTING" | "ACCEPT_NEW" | "MERGE";
type ConflictStatus = "OPEN" | "RESOLVED";

interface ConflictRecord {
  id: string;                           // "conf_<ULID>"
  organizationId: string;
  projectId: string;
  proposalId: string;
  conflictingKnowledgeId: string;
  explanation: string;                  // from ContradictionDetector
  status: ConflictStatus;               // default: OPEN
  resolution: ConflictResolution | null;
  mergedContent: Record<string, unknown> | null;  // only for MERGE resolution
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}
```

### 2.4 KnowledgeItem — contentHash field

Add `contentHash: string` (SHA-256 of serialized `content`) to `KnowledgeItem`. Computed and stored on every create/update. Used by `FreshnessChecker` to detect significant source changes.

### 2.5 FreshnessConfig (AppConfig addition)

```ts
interface FreshnessConfig {
  ttlDays: Partial<Record<KnowledgeType, number>>;
  // Defaults applied when key absent:
  //   Procedure:       30
  //   Troubleshooting: 60
  //   Architecture:    90
  //   Decision:        90
  //   Concept:         180
  //   Investigation:   180
}
```

Added to `AppConfig` under `freshness`.

---

## 3. API Design

### 3.1 Auth — Token creation update

```
POST /tokens
  body: { name: string, role?: PrincipalRole }  // role defaults to "READER"
  → 201 { token: ServiceToken }
```

Existing token endpoints unchanged. No migration of old tokens required — old tokens without `role` are treated as `READER` at runtime via a null-coalescing default in the auth plugin.

### 3.2 Proposals (full rewrite of existing routes)

All routes under `/organizations/:orgId/projects/:projectId/proposals`.

```
POST   /proposals
  body: { type, title, summary, content, sourceIds?, knowledgeItemId?, triggeredBy? }
  Runs synchronously: structural → duplicate → contradiction checks
  → hard duplicate: 409 DuplicateProposalError (no record created)
  → soft warning (cosine ≥ 0.85): proposal created, validationResults includes WARN
  → contradiction detected: ConflictRecord created (status: OPEN), proposal created
  → status: PROPOSED → VALIDATING (on create)
  → 201 { proposal, conflictRecords[] }

GET    /proposals?status=&limit=&offset=
  → sorted by proposedAt DESC
  → 200 { proposals: Proposal[], total: number }

GET    /proposals/:id
  → includes validationResults, conflictRecords[]
  → 200 Proposal

POST   /proposals/:id/approve        [REVIEWER or ADMIN]
  body: { content? }                 // optional edit applied before publish
  → VALIDATING → ACCEPTED → PUBLISHED (atomic)
  → creates KnowledgeItem (status: PUBLISHED) or updates existing if knowledgeItemId set
  → emits APPROVE audit event
  → 200 { proposal, knowledgeItem }

POST   /proposals/:id/reject         [REVIEWER or ADMIN]
  body: { reason: string }           // required
  → VALIDATING → REJECTED
  → emits REJECT audit event
  → 200 Proposal

POST   /proposals/:id/request-changes  [REVIEWER or ADMIN]
  body: { feedback: string }
  → VALIDATING → CHANGES_REQUESTED
  → emits audit event (new AuditEventType: "REQUEST_CHANGES")
  → 200 Proposal

POST   /proposals/bulk-approve       [REVIEWER or ADMIN]
  body: { ids: string[], content?: Record<string, Record<string, unknown>> }
  // content keyed by proposal id for per-proposal edits
  → all-or-none transaction: if any proposal not in VALIDATING, entire batch 422
  → 207 { results: Array<{ id, status: "approved"|"failed", knowledgeItemId? }> }

POST   /proposals/bulk-reject        [REVIEWER or ADMIN]
  body: { ids: string[], reason: string }
  → all-or-none (same rule as bulk-approve)
  → 207 { results: Array<{ id, status: "rejected"|"failed" }> }
```

### 3.3 Conflicts

```
GET    /organizations/:orgId/projects/:projectId/conflicts?status=OPEN|RESOLVED&limit=&offset=
  → sorted by createdAt DESC
  → 200 { conflicts: ConflictRecord[], total: number }

POST   /conflicts/:id/resolve        [REVIEWER or ADMIN]
  body: {
    action: "KEEP_EXISTING" | "ACCEPT_NEW" | "MERGE",
    mergedContent?: Record<string, unknown>   // required when action = "MERGE"
  }
  Effects:
    KEEP_EXISTING  → rejects the linked proposal (REJECTED), closes conflict
    ACCEPT_NEW     → approves proposal (PUBLISHED), deprecates conflictingKnowledgeId
    MERGE          → publishes proposal with mergedContent, deprecates conflictingKnowledgeId
  → emits audit event (new AuditEventType: "RESOLVE_CONFLICT")
  → 200 ConflictRecord
```

### 3.4 Freshness

```
PATCH  /knowledge/:id/verify         [any authenticated principal]
  body: {}
  → if status = STALE: transition to PUBLISHED, reset lastVerifiedAt
  → else: reset lastVerifiedAt only (does not change status)
  → emits VERIFY audit event
  → 200 KnowledgeItem
```

`FreshnessChecker` is not exposed as an HTTP endpoint. It runs:
1. Triggered after each `IncrementalSync.sync()` completes.
2. On a configurable cron interval (default: daily at 02:00 UTC via `node-cron` or equivalent).

### 3.5 MCP Server

Entry point: `src/mcp-server.ts` (separate from `src/server.ts`). Started by a new npm script: `start:mcp`.

```
Transport A — stdio:
  For local agent use. Reads JSON-RPC from stdin, writes to stdout.

Transport B — HTTP/SSE:
  Port: configurable (default 3001).
  GET  /sse          — SSE event stream (server-sent events)
  POST /messages     — receive client messages
  GET  /health       — readiness check

Auth (HTTP transport):
  Header: x-api-key: <service_token>
  Validated against Project Memory auth on each tool call.

MCP lifecycle:
  initialize         — returns serverInfo + capabilities
  tools/list         — returns all registered tool schemas
  tools/call         — dispatches to tool handler

Tools (v1):
  knowledge.search   → HybridRetriever.search() directly (no HTTP hop)
  knowledge.propose  → ProposalService.create()
  knowledge.impact   → ImpactAnalyzer.analyze()

Tool schemas: loaded from specs/mcp/tools/*.json at startup.
```

---

## 4. Module Structure

### 4.1 New / changed files

```
src/
├── modules/
│   ├── auth/
│   │   ├── entities.ts             + role: PrincipalRole on ServiceToken
│   │   └── repository.ts           + role filter on token lookups
│   │
│   ├── governance/
│   │   ├── audit-entities.ts       + "REQUEST_CHANGES" | "RESOLVE_CONFLICT" event types
│   │   ├── proposal-entities.ts    NEW — Proposal, ValidationResult, ProposalStatus types
│   │   ├── proposal-store.ts       NEW — MongoDB CRUD for proposals collection
│   │   ├── proposal-service.ts     NEW — create (with validation), approve, reject,
│   │   │                                 request-changes, bulk ops
│   │   ├── conflict-entities.ts    NEW — ConflictRecord, ConflictResolution types
│   │   ├── conflict-store.ts       NEW — MongoDB CRUD for conflicts collection
│   │   ├── conflict-service.ts     NEW — resolve() with 3 actions
│   │   ├── freshness-checker.ts    NEW — TTL + source-hash check, emits MARK_STALE
│   │   ├── freshness-config.ts     NEW — per-type TTL defaults
│   │   ├── duplicate-detector.ts   unchanged
│   │   └── contradiction-detector.ts  unchanged
│   │
│   ├── ingestion/
│   │   ├── entities.ts             REMOVE KnowledgeProposal — import Proposal from governance/
│   │   ├── proposal-store.ts       REMOVE — replaced by governance/proposal-store.ts
│   │   ├── incremental-sync.ts     + call FreshnessChecker.check() after sync
│   │   └── bootstrap-proposal-generator.ts  update import paths
│   │
│   └── mcp/
│       ├── server.ts               NEW — MCP lifecycle handler
│       ├── transports.ts           NEW — stdio + HTTP/SSE setup
│       ├── tool-registry.ts        NEW — load specs/mcp/tools/*.json, dispatch
│       └── tools/
│           ├── search.ts           NEW
│           ├── propose.ts          NEW
│           └── impact.ts           NEW
│
├── routes/
│   ├── proposals.ts                REWRITE — new FSM, roles, bulk ops, request-changes
│   ├── conflicts.ts                NEW
│   └── knowledge.ts                + PATCH /:id/verify
│
├── app.ts                          + register conflicts route
├── mcp-server.ts                   NEW — MCP entry point
└── config/
    └── index.ts                    + freshness config block
```

### 4.2 MongoDB collections

| Collection | Key indexes (new) |
|------------|------------------|
| `proposals` | `(organizationId, projectId, status)`, `(contentHash, organizationId, projectId)` unique-sparse |
| `conflicts` | `(organizationId, projectId, status)`, `(proposalId)` |

### 4.3 ID prefix additions

| Entity | Prefix |
|--------|--------|
| Proposal | `prop_` (unchanged from KnowledgeProposal) |
| ConflictRecord | `conf_` |

---

## 5. Implementation Order

### Track 1 — Independent (start immediately, parallel)

**1a. Auth roles**
- `ServiceToken` entity + role field
- Auth plugin: attach `req.principal.role`, null-coalesce old tokens to `READER`
- `requireRole(minRole)` utility (READER < REVIEWER < ADMIN)
- Update `POST /tokens` to accept role
- Tests: 403 for READER attempting REVIEWER action, ADMIN bypasses all checks

**1b. Freshness detection**
- `freshness-config.ts` defaults
- `freshness-checker.ts` (TTL + source-hash logic, marks STALE, emits MARK_STALE audit event)
- `PATCH /knowledge/:id/verify` endpoint + VERIFY audit event
- Wire `FreshnessChecker.check()` into `IncrementalSync.sync()` post-hook
- `contentHash` field on `KnowledgeItem` (computed on create/update in existing routes)
- Tests: TTL expiry marks STALE, source change marks STALE, verify resets lastVerifiedAt

### Track 2 — Sequential (after 1a roles land)

**2a. Proposal entity + store + service**
- `proposal-entities.ts`, `proposal-store.ts`
- `proposal-service.ts`: create() with full validation pipeline, approve(), reject(), requestChanges(), bulkApprove(), bulkReject()
- Remove `KnowledgeProposal` from ingestion; update `BootstrapProposalGenerator` + `IncrementalSync` imports
- Tests: FSM transitions, hard duplicate rejection, contradictions create ConflictRecords

**2b. Rewrite proposals.ts routes**
- All 8 proposal endpoints (including bulk ops)
- `requireRole` guards on approve/reject/request-changes/bulk ops
- Tests: full create→approve→published flow; 403 for READER; bulk atomicity

**2c. Conflict entities + store + service + route**
- `conflict-entities.ts`, `conflict-store.ts`, `conflict-service.ts`
- `routes/conflicts.ts`
- `requireRole` guard on resolve
- Tests: each resolution action (KEEP_EXISTING, ACCEPT_NEW, MERGE) + audit events

### Track 3 — After Track 2 stable

**3a. MCP server foundation**
- `src/mcp-server.ts` entry + npm `start:mcp` script
- `src/modules/mcp/server.ts` + `transports.ts` (stdio + HTTP/SSE)
- `tool-registry.ts` loads `specs/mcp/tools/*.json`
- `initialize` + `tools/list` working
- Health endpoint
- Tests: tools/list returns expected schemas, invalid tool call returns MCP-compliant error

**3b. MCP tools**
- `tools/search.ts`, `tools/propose.ts`, `tools/impact.ts`
- End-to-end: MCP call → service → response
- Tests: each tool maps input correctly, errors are MCP-compliant (not raw 500s)

---

## 6. Acceptance Criteria Summary

### PM-044 Freshness
- After modifying a source file, related PUBLISHED KnowledgeItem transitions to STALE within one IncrementalSync cycle
- TTL expiry (configurable per knowledge type) also marks STALE
- `PATCH /knowledge/:id/verify` resets lastVerifiedAt and clears STALE status
- MARK_STALE emits AuditEvent

### PM-045 Proposal lifecycle
- Full flow PROPOSED → VALIDATING → ACCEPTED → PUBLISHED completes correctly
- REJECTED proposal cannot be re-approved without re-creation
- Every state transition recorded in AuditEvent
- Hard duplicate (cosine ≥ 0.92 or exact title) returns 409, no record created

### PM-046 Human review API
- READER role attempting approve/reject returns 403
- Approving with content edit publishes the edited version, not the original
- Bulk approve of 10 proposals succeeds atomically (all or none)
- `request-changes` transitions to CHANGES_REQUESTED with feedback stored

### PM-047 Conflict resolution
- KEEP_EXISTING rejects the proposal and closes the conflict
- ACCEPT_NEW publishes the proposal and deprecates the conflicting item
- MERGE publishes with mergedContent and deprecates the conflicting item
- All resolutions emit audit events
- Only REVIEWER/ADMIN can resolve conflicts

### PM-050 MCP server
- MCP server starts and responds to `tools/list` with correct schemas
- Invalid tool call returns MCP-compliant error (not 500)
- stdio and HTTP/SSE transports both functional
- Health endpoint returns 200 when connected

---

## 7. Out of Scope

- Push notifications for STALE items (polling via `GET /knowledge?status=STALE` is sufficient)
- User/person accounts (principals are service tokens only)
- MCP tools beyond search, propose, impact (v1 scope)
- Database migration scripts (MongoDB is schemaless; old KnowledgeProposal documents are orphaned, not migrated)
