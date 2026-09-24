# Governance, Freshness, Conflict Resolution & MCP Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement auth roles, proposal lifecycle FSM, human review API, conflict resolution, freshness detection, and MCP server foundation (issues #32–#36).

**Architecture:** Five feature tracks on top of the existing Fastify 5 + MongoDB stack. Track 1 (roles + freshness) runs independently; Track 2 (proposal FSM rewrite → reviewer API → conflicts) is sequential; Track 3 (MCP server) wraps Track 2. `KnowledgeProposal` in `src/modules/ingestion/` is fully replaced by a richer `Proposal` in `src/modules/governance/`.

**Tech Stack:** Fastify 5, MongoDB, Zod, Vitest, `@modelcontextprotocol/sdk`

**Spec:** `docs/superpowers/specs/2026-09-24-governance-mcp-issues-32-36-design.md`

## Global Constraints

- All new IDs follow existing `prefix_<ULID>` pattern (prefix: `conf_`)
- All new collections use `{ projection: { _id: 0 } }` on reads
- All new Zod schemas use `.strict()` for bodies
- Tests use `createFakeDb()` from `test/support/fake-db.ts` — no real MongoDB
- Run tests: `npm test` (Vitest)
- Build check: `npx tsc --noEmit`
- Commit after every task

---

### Task 1: Auth roles on ServiceToken

**Files:**
- Modify: `src/modules/auth/entities.ts`
- Modify: `src/modules/auth/actor.ts`
- Modify: `src/modules/auth/repository.ts`
- Modify: `src/plugins/authentication.ts`
- Modify: `src/routes/tokens.ts`
- Test: `test/modules/auth/actor.test.ts` (modify)
- Test: `test/routes/tokens.test.ts` (modify)

**Interfaces:**
- Produces: `PrincipalRole = "ADMIN" | "REVIEWER" | "READER"` on `ServiceToken` and `Actor`
- Produces: `requireRole(actor: Actor | undefined, min: PrincipalRole): void` (throws `ForbiddenScopeError`)

- [ ] **Step 1: Write failing tests**

```typescript
// test/modules/auth/actor.test.ts — add to existing file
import { describe, it, expect } from "vitest";
import { requireRole } from "../../src/modules/auth/actor.js";
import { ForbiddenScopeError } from "../../src/lib/errors.js";
import type { Actor } from "../../src/modules/auth/actor.js";

describe("requireRole", () => {
  const reader: Actor = { actorId: "tok_1", organizationId: "org_1", type: "service", role: "READER" };
  const reviewer: Actor = { actorId: "tok_2", organizationId: "org_1", type: "service", role: "REVIEWER" };
  const admin: Actor = { actorId: "tok_3", organizationId: "org_1", type: "service", role: "ADMIN" };

  it("READER satisfies READER", () => expect(() => requireRole(reader, "READER")).not.toThrow());
  it("READER fails REVIEWER", () => expect(() => requireRole(reader, "REVIEWER")).toThrow(ForbiddenScopeError));
  it("REVIEWER satisfies REVIEWER", () => expect(() => requireRole(reviewer, "REVIEWER")).not.toThrow());
  it("REVIEWER fails ADMIN", () => expect(() => requireRole(reviewer, "ADMIN")).toThrow(ForbiddenScopeError));
  it("ADMIN satisfies REVIEWER", () => expect(() => requireRole(admin, "REVIEWER")).not.toThrow());
  it("undefined actor throws", () => expect(() => requireRole(undefined, "READER")).toThrow(ForbiddenScopeError));
});
```

- [ ] **Step 2: Run test — expect FAIL** (`npm test -- actor`)

- [ ] **Step 3: Implement**

`src/modules/auth/entities.ts` — add role:
```typescript
import { ulid } from "ulid";
import { z } from "zod";

export type PrincipalRole = "ADMIN" | "REVIEWER" | "READER";

export interface ServiceToken {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  hashedSecret: string;
  createdAt: string;
  revokedAt: string | null;
  role: PrincipalRole;
}

export const tokenIdSchema = z.string().regex(/^tok_[0-9A-HJKMNP-TV-Z]{26}$/);
const nameSchema = z.string().trim().min(1);
export const createTokenBodySchema = z.object({
  name: nameSchema,
  role: z.enum(["ADMIN", "REVIEWER", "READER"]).default("READER"),
});

export function newTokenId(): string {
  return `tok_${ulid()}`;
}
```

`src/modules/auth/actor.ts` — add role to Actor + requireRole:
```typescript
import { ForbiddenScopeError, UnauthorizedError } from "../../lib/errors.js";
import { hashSecret } from "./secret.js";
import type { TokenRepository } from "./repository.js";
import type { PrincipalRole } from "./entities.js";

export interface Actor {
  actorId: string;
  organizationId: string;
  type: "service";
  role: PrincipalRole;
}

const ROLE_ORDER: PrincipalRole[] = ["READER", "REVIEWER", "ADMIN"];

export function requireRole(actor: Actor | undefined, min: PrincipalRole): void {
  if (!actor) throw new ForbiddenScopeError("missing credentials");
  if (ROLE_ORDER.indexOf(actor.role) < ROLE_ORDER.indexOf(min)) {
    throw new ForbiddenScopeError(`requires ${min} role`);
  }
}

const BEARER = "Bearer ";

export function parseBearer(header: string | undefined): string {
  if (header === undefined || !header.startsWith(BEARER)) {
    throw new UnauthorizedError("missing or malformed credentials");
  }
  const secret = header.slice(BEARER.length).trim();
  if (secret.length === 0) throw new UnauthorizedError("missing or malformed credentials");
  return secret;
}

export async function resolveActor(
  repo: TokenRepository,
  pepper: string,
  header: string | undefined,
): Promise<Actor> {
  const secret = parseBearer(header);
  const token = await repo.findActiveByHash(hashSecret(secret, pepper));
  if (!token) throw new UnauthorizedError("invalid credentials");
  return {
    actorId: token.id,
    organizationId: token.organizationId,
    type: "service",
    role: token.role ?? "READER",
  };
}
```

`src/modules/auth/repository.ts` — update `createToken` to accept role:
```typescript
async createToken(organizationId: string, name: string, role: PrincipalRole = "READER") {
  const { secret, prefix } = generateSecret();
  const token: ServiceToken = {
    id: newTokenId(),
    organizationId,
    name,
    prefix,
    hashedSecret: hashSecret(secret, pepper),
    createdAt: new Date().toISOString(),
    revokedAt: null,
    role,
  };
  await col().insertOne(token);
  return { token, secret };
},
```
Update `TokenRepository` interface accordingly: `createToken(organizationId: string, name: string, role?: PrincipalRole): Promise<{ token: ServiceToken; secret: string }>`.

`src/routes/tokens.ts` — pass role from body:
```typescript
const { name, role } = parseOrThrow(createTokenBodySchema, req.body, "name is required");
const { token, secret } = await tokens().createToken(orgId, name, role);
```

- [ ] **Step 4: Run tests — expect PASS** (`npm test -- actor`)

- [ ] **Step 5: Build check** (`npx tsc --noEmit`)

- [ ] **Step 6: Commit**
```bash
git add src/modules/auth/ src/routes/tokens.ts test/modules/auth/actor.test.ts
git commit -m "feat(auth): add role field to ServiceToken and Actor, add requireRole guard"
```

---

### Task 2: Freshness detection + /verify endpoint

**Files:**
- Modify: `src/modules/knowledge-core/entities.ts` (add `contentHash`)
- Modify: `src/modules/knowledge-core/repository.ts` (store contentHash on create/update)
- Modify: `src/modules/knowledge-core/lifecycle.ts` (allow STALE → PUBLISHED)
- Modify: `src/config/index.ts` (add freshness config)
- Create: `src/modules/governance/freshness-config.ts`
- Create: `src/modules/governance/freshness-checker.ts`
- Modify: `src/modules/governance/audit-entities.ts` (add REQUEST_CHANGES, RESOLVE_CONFLICT)
- Modify: `src/routes/knowledge.ts` (add PATCH /:id/verify)
- Modify: `src/modules/ingestion/incremental-sync.ts` (call FreshnessChecker after sync)
- Modify: `src/lib/indexes.ts` (add conflicts collection index)
- Test: `test/modules/governance/freshness-checker.test.ts`
- Test: `test/routes/knowledge-verify.test.ts`

**Interfaces:**
- Produces: `FreshnessChecker.check(db, orgId, projectId, config): Promise<{ marked: number }>`
- Consumes: `KnowledgeItemStore` (findByProject, update), `AuditEventStore` (append)

- [ ] **Step 1: Write failing tests**

```typescript
// test/modules/governance/freshness-checker.test.ts
import { describe, it, expect } from "vitest";
import { createFakeDb } from "../../support/fake-db.js";
import { FreshnessChecker } from "../../../src/modules/governance/freshness-checker.js";
import type { KnowledgeItem } from "../../../src/modules/knowledge-core/entities.js";

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: "know_01", organizationId: "org_1", projectId: "proj_1",
    type: "Procedure", title: "T", summary: "S", content: {},
    status: "PUBLISHED", version: 1, ownerId: "tok_1",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    lastVerifiedAt: "2026-01-01T00:00:00.000Z",
    sourceIds: [], embedding: null, embeddingModel: null, embeddingUpdatedAt: null,
    contentHash: "abc",
    ...overrides,
  };
}

describe("FreshnessChecker", () => {
  it("marks STALE when TTL expired", async () => {
    const { db, rows } = createFakeDb({
      knowledge_items: [makeItem({ lastVerifiedAt: "2020-01-01T00:00:00.000Z" })],
      audit_events: [],
    });
    const checker = new FreshnessChecker(db);
    const result = await checker.check("org_1", "proj_1", { ttlDays: { Procedure: 30 } });
    expect(result.marked).toBe(1);
    expect(rows.knowledge_items[0].status).toBe("STALE");
  });

  it("does not re-mark already STALE items", async () => {
    const { db, rows } = createFakeDb({
      knowledge_items: [makeItem({ status: "STALE", lastVerifiedAt: "2020-01-01T00:00:00.000Z" })],
      audit_events: [],
    });
    const checker = new FreshnessChecker(db);
    const result = await checker.check("org_1", "proj_1", { ttlDays: { Procedure: 30 } });
    expect(result.marked).toBe(0);
  });

  it("leaves fresh items alone", async () => {
    const { db, rows } = createFakeDb({
      knowledge_items: [makeItem({ lastVerifiedAt: new Date().toISOString() })],
      audit_events: [],
    });
    const checker = new FreshnessChecker(db);
    const result = await checker.check("org_1", "proj_1", { ttlDays: { Procedure: 30 } });
    expect(result.marked).toBe(0);
    expect(rows.knowledge_items[0].status).toBe("PUBLISHED");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (`npm test -- freshness`)

- [ ] **Step 3: Implement**

`src/modules/governance/freshness-config.ts`:
```typescript
import type { KnowledgeType } from "../knowledge-core/entities.js";

export interface FreshnessConfig {
  ttlDays: Partial<Record<KnowledgeType, number>>;
}

export const DEFAULT_TTL_DAYS: Record<KnowledgeType, number> = {
  Procedure: 30,
  Troubleshooting: 60,
  Architecture: 90,
  Decision: 90,
  Concept: 180,
  Investigation: 180,
};

export function getTtlDays(config: FreshnessConfig, type: KnowledgeType): number {
  return config.ttlDays[type] ?? DEFAULT_TTL_DAYS[type];
}
```

`src/modules/governance/freshness-checker.ts`:
```typescript
import type { Db } from "mongodb";
import type { KnowledgeItem, KnowledgeType } from "../knowledge-core/entities.js";
import type { FreshnessConfig } from "./freshness-config.js";
import { getTtlDays } from "./freshness-config.js";
import { newAuditEventId } from "./audit-entities.js";
import type { AuditEvent } from "./audit-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export class FreshnessChecker {
  constructor(private readonly db: Db) {}

  async check(
    orgId: string,
    projectId: string,
    config: FreshnessConfig,
  ): Promise<{ marked: number }> {
    const col = this.db.collection<KnowledgeItem>("knowledge_items");
    const auditCol = this.db.collection<AuditEvent>("audit_events");
    const items = (await col
      .find({ organizationId: orgId, projectId, status: "PUBLISHED" } as unknown as Partial<KnowledgeItem>, READ_OPTS)
      .toArray()) as KnowledgeItem[];

    const now = Date.now();
    let marked = 0;

    for (const item of items) {
      const ttlMs = getTtlDays(config, item.type as KnowledgeType) * 24 * 60 * 60 * 1000;
      const verifiedAt = item.lastVerifiedAt ? new Date(item.lastVerifiedAt).getTime() : 0;
      if (now - verifiedAt < ttlMs) continue;

      await col.findOneAndUpdate(
        { id: item.id, organizationId: orgId } as unknown as Partial<KnowledgeItem>,
        { $set: { status: "STALE", updatedAt: new Date().toISOString() } },
      );
      await auditCol.insertOne({
        id: newAuditEventId(), organizationId: orgId,
        eventType: "MARK_STALE", targetId: item.id, targetType: "knowledge",
        actorId: "system", actorName: "system",
        timestamp: new Date().toISOString(),
      } as unknown as AuditEvent);
      marked++;
    }

    return { marked };
  }
}
```

Add `contentHash?: string` to `KnowledgeItem` interface in `src/modules/knowledge-core/entities.ts` (optional for backward compat with existing documents).

Update lifecycle.ts to allow `STALE → PUBLISHED`:
```typescript
STALE: ["PUBLISHED"],
```

Add audit event types to `src/modules/governance/audit-entities.ts`:
```typescript
export type AuditEventType =
  | "CREATE" | "UPDATE" | "DEPRECATE"
  | "RELATION_CREATE" | "RELATION_UPDATE" | "RELATION_DELETE"
  | "APPROVE" | "REJECT" | "VERIFY" | "MARK_STALE"
  | "REQUEST_CHANGES" | "RESOLVE_CONFLICT";
```

Add `PATCH /knowledge/:id/verify` to `src/routes/knowledge.ts` (insert before the `DELETE /knowledge/:id` route):
```typescript
app.patch("/knowledge/:id/verify", BEARER, async (req) => {
  const actor = req.actor;
  if (!actor) throw new UnauthorizedError("missing credentials");
  const ctx = context(req);
  const { id } = req.params as { id: string };
  parseOrThrow(knowledgeIdSchema, id, "knowledge id is malformed");

  const item = await store().findById(ctx.organizationId, id);
  if (!item) throw new NotFoundError("knowledge item not found");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { lastVerifiedAt: now };
  if (item.status === "STALE") patch.status = "PUBLISHED";

  const updated = await store().update(ctx.organizationId, id, patch as Parameters<typeof store extends () => infer S ? S : never>["update"] extends (...args: infer A) => unknown ? A[2] : never);
  await auditStore().append({
    organizationId: ctx.organizationId, eventType: "VERIFY",
    targetId: id, targetType: "knowledge",
    actorId: actor.actorId, actorName: actor.actorId,
  });
  return updated;
});
```

Wire `FreshnessChecker` into `IncrementalSync.sync()` — add at the end of the method, before returning:
```typescript
// In incremental-sync.ts constructor, add freshnessChecker param
import { FreshnessChecker } from "../governance/freshness-checker.js";
import type { FreshnessConfig } from "../governance/freshness-config.js";

// Add to constructor params:
private readonly freshnessConfig: FreshnessConfig = { ttlDays: {} },

// At end of sync(), before return:
await new FreshnessChecker(this.knowledgeStore["db"] ?? this.db).check(orgId, projectId, this.freshnessConfig);
```

Actually, simpler — pass `db` directly. Update `IncrementalSync` constructor to accept `db: Db` as last optional param and use it for FreshnessChecker. Or just add a `freshnessCheck` method the route can call after sync. For simplicity, add db param:

```typescript
// incremental-sync.ts
import type { Db } from "mongodb";
import { FreshnessChecker } from "../governance/freshness-checker.js";
import { DEFAULT_TTL_DAYS } from "../governance/freshness-config.js";

export class IncrementalSync {
  constructor(
    private readonly git: GitConnector,
    private readonly knowledgeStore: KnowledgeItemStore,
    private readonly sourceStore: SourceStore,
    private readonly proposalStore: ProposalStore,
    private readonly repoStore: RepositoryStore,
    private readonly db?: Db,
  ) {}

  // At end of sync(), before final return:
  if (this.db) {
    await new FreshnessChecker(this.db).check(orgId, projectId, { ttlDays: DEFAULT_TTL_DAYS });
  }
```

Update `routes/repositories.ts` to pass `app.db` as last arg when constructing `IncrementalSync`.

Add `conflicts` collection to `src/lib/indexes.ts` in `CORE_COLLECTIONS`:
```typescript
"conflicts",
```
And add to `CORE_COLLECTION_EXTRA_INDEXES`:
```typescript
conflicts: [
  { key: { id: 1 }, name: "id_unique", unique: true },
  { key: { organizationId: 1, projectId: 1, status: 1 }, name: "project_status" },
  { key: { proposalId: 1 }, name: "proposal_lookup" },
],
```

- [ ] **Step 4: Run tests — expect PASS** (`npm test -- freshness`)

- [ ] **Step 5: Build check** (`npx tsc --noEmit`)

- [ ] **Step 6: Commit**
```bash
git add src/modules/governance/freshness-checker.ts src/modules/governance/freshness-config.ts \
  src/modules/knowledge-core/entities.ts src/modules/knowledge-core/lifecycle.ts \
  src/modules/governance/audit-entities.ts src/modules/ingestion/incremental-sync.ts \
  src/routes/knowledge.ts src/lib/indexes.ts \
  test/modules/governance/freshness-checker.test.ts
git commit -m "feat(freshness): FreshnessChecker, PATCH /knowledge/:id/verify, STALE→PUBLISHED lifecycle"
```

---

### Task 3: Proposal entity, store, and service (replaces KnowledgeProposal)

**Files:**
- Create: `src/modules/governance/proposal-entities.ts`
- Create: `src/modules/governance/proposal-store.ts`
- Create: `src/modules/governance/proposal-service.ts`
- Modify: `src/modules/ingestion/entities.ts` (re-export from governance for compat)
- Modify: `src/modules/ingestion/proposal-repository.ts` (re-export from governance)
- Modify: `src/modules/ingestion/bootstrap-proposal-generator.ts` (update types)
- Modify: `src/modules/ingestion/incremental-sync.ts` (update types)
- Test: `test/modules/governance/proposal-store.test.ts`
- Test: `test/modules/governance/proposal-service.test.ts`

**Interfaces:**
- Produces: `Proposal`, `ProposalStatus`, `createProposalStore(db)`, `ProposalService`
- Consumes: `DuplicateDetector`, `ContradictionDetector`, `KnowledgeItemStore`, `AuditEventStore`

- [ ] **Step 1: Write failing tests**

```typescript
// test/modules/governance/proposal-store.test.ts
import { describe, it, expect } from "vitest";
import { createFakeDb } from "../../support/fake-db.js";
import { createProposalStore } from "../../../src/modules/governance/proposal-store.js";

describe("ProposalStore", () => {
  it("creates a proposal in VALIDATING status", async () => {
    const { db } = createFakeDb({ proposals: [], conflicts: [] });
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1", type: "Decision",
      title: "Use Postgres", summary: "We should use Postgres",
      content: { context: "ctx", problem: "p", decision: "d" },
      sourceIds: [], triggeredBy: "manual", proposedBy: "tok_1",
      knowledgeItemId: null, validationResults: [],
    });
    expect(p.status).toBe("VALIDATING");
    expect(p.id).toMatch(/^prop_/);
  });

  it("existsByHash returns true for duplicate contentHash", async () => {
    const { db } = createFakeDb({ proposals: [], conflicts: [] });
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1", type: "Decision",
      title: "T", summary: "S", content: {}, sourceIds: [],
      triggeredBy: "manual", proposedBy: "tok_1", knowledgeItemId: null,
      validationResults: [],
    });
    const exists = await store.existsByHash("org_1", "proj_1", p.contentHash);
    expect(exists).toBe(true);
  });

  it("approve transitions to PUBLISHED and sets reviewedBy", async () => {
    const { db } = createFakeDb({ proposals: [], conflicts: [] });
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1", type: "Decision",
      title: "T", summary: "S", content: {}, sourceIds: [],
      triggeredBy: "manual", proposedBy: "tok_1", knowledgeItemId: null,
      validationResults: [],
    });
    const approved = await store.approve("org_1", p.id, "tok_reviewer", "know_1");
    expect(approved?.status).toBe("PUBLISHED");
    expect(approved?.reviewedBy).toBe("tok_reviewer");
  });

  it("reject transitions to REJECTED with reason", async () => {
    const { db } = createFakeDb({ proposals: [], conflicts: [] });
    const store = createProposalStore(db);
    const p = await store.create({
      organizationId: "org_1", projectId: "proj_1", type: "Decision",
      title: "T", summary: "S", content: {}, sourceIds: [],
      triggeredBy: "manual", proposedBy: "tok_1", knowledgeItemId: null,
      validationResults: [],
    });
    const rejected = await store.reject("org_1", p.id, "tok_reviewer", "not relevant");
    expect(rejected?.status).toBe("REJECTED");
    expect(rejected?.rejectionReason).toBe("not relevant");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement**

`src/modules/governance/proposal-entities.ts`:
```typescript
import { ulid } from "ulid";
import type { KnowledgeType } from "../knowledge-core/entities.js";

export const PROPOSAL_STATUSES = [
  "PROPOSED", "VALIDATING", "ACCEPTED", "PUBLISHED", "REJECTED", "CHANGES_REQUESTED",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ValidationResult {
  checkType: "structural" | "duplicate" | "contradiction";
  status: "PASS" | "FAIL" | "WARN";
  message: string;
  details?: unknown;
}

export interface Proposal {
  id: string;
  organizationId: string;
  projectId: string;
  knowledgeItemId: string | null;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  status: ProposalStatus;
  proposedBy: string;
  proposedAt: string;
  validationResults: ValidationResult[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  changesFeedback: string | null;
  sourceIds: string[];
  contentHash: string;
  triggeredBy: "bootstrap" | "incremental" | "manual";
  createdAt: string;
  updatedAt: string;
}

export function newProposalId(): string {
  return `prop_${ulid()}`;
}
```

`src/modules/governance/proposal-store.ts`:
```typescript
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { newProposalId, type Proposal, type ProposalStatus } from "./proposal-entities.js";
import type { KnowledgeType } from "../knowledge-core/entities.js";
import type { ValidationResult } from "./proposal-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateProposalInput {
  organizationId: string;
  projectId: string;
  type: KnowledgeType;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  sourceIds: string[];
  triggeredBy: "bootstrap" | "incremental" | "manual";
  proposedBy: string;
  knowledgeItemId: string | null;
  validationResults: ValidationResult[];
}

export interface ProposalStore {
  create(input: CreateProposalInput): Promise<Proposal>;
  findById(orgId: string, id: string): Promise<Proposal | null>;
  findByProject(orgId: string, projectId: string, filter?: { status?: ProposalStatus }): Promise<Proposal[]>;
  existsByHash(orgId: string, projectId: string, hash: string): Promise<boolean>;
  approve(orgId: string, id: string, actorId: string, knowledgeItemId: string): Promise<Proposal | null>;
  reject(orgId: string, id: string, actorId: string, reason: string): Promise<Proposal | null>;
  requestChanges(orgId: string, id: string, actorId: string, feedback: string): Promise<Proposal | null>;
}

function hashProposal(type: string, title: string, summary: string): string {
  return createHash("sha256").update(`${type}:${title}:${summary}`).digest("hex");
}

export function createProposalStore(db: Db): ProposalStore {
  const col = () => db.collection<Proposal>("proposals");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const proposal: Proposal = {
        id: newProposalId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        knowledgeItemId: input.knowledgeItemId,
        type: input.type,
        title: input.title,
        summary: input.summary,
        content: input.content,
        status: "VALIDATING",
        proposedBy: input.proposedBy,
        proposedAt: now,
        validationResults: input.validationResults,
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        changesFeedback: null,
        sourceIds: input.sourceIds,
        contentHash: hashProposal(input.type, input.title, input.summary),
        triggeredBy: input.triggeredBy,
        createdAt: now,
        updatedAt: now,
      };
      await col().insertOne({ ...proposal });
      return proposal;
    },

    async findById(orgId, id) {
      return col().findOne({ id, organizationId: orgId }, READ_OPTS) as Promise<Proposal | null>;
    },

    async findByProject(orgId, projectId, filter) {
      const query: Record<string, unknown> = { organizationId: orgId, projectId };
      if (filter?.status) query.status = filter.status;
      return col().find(query as unknown as Partial<Proposal>, READ_OPTS).toArray() as Promise<Proposal[]>;
    },

    async existsByHash(orgId, projectId, hash) {
      return (await col().findOne({ organizationId: orgId, projectId, contentHash: hash } as unknown as Partial<Proposal>, READ_OPTS)) !== null;
    },

    async approve(orgId, id, actorId, knowledgeItemId) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "VALIDATING" } as unknown as Partial<Proposal>,
        { $set: { status: "PUBLISHED", reviewedBy: actorId, reviewedAt: now, knowledgeItemId, updatedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<Proposal | null>;
    },

    async reject(orgId, id, actorId, reason) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "VALIDATING" } as unknown as Partial<Proposal>,
        { $set: { status: "REJECTED", reviewedBy: actorId, reviewedAt: now, rejectionReason: reason, updatedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<Proposal | null>;
    },

    async requestChanges(orgId, id, actorId, feedback) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "VALIDATING" } as unknown as Partial<Proposal>,
        { $set: { status: "CHANGES_REQUESTED", reviewedBy: actorId, reviewedAt: now, changesFeedback: feedback, updatedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<Proposal | null>;
    },
  };
}
```

Update `src/modules/ingestion/entities.ts` to re-export from governance (backward compat for bootstrap-generator and incremental-sync):
```typescript
// Re-export governance proposal types for backward compat
export type { ProposalStatus, Proposal as KnowledgeProposal } from "../governance/proposal-entities.js";
export { PROPOSAL_STATUSES, newProposalId } from "../governance/proposal-entities.js";
```

Update `src/modules/ingestion/proposal-repository.ts` — re-export `createProposalStore` and `ProposalStore` from governance:
```typescript
export type { ProposalStore, CreateProposalInput } from "../governance/proposal-store.js";
export { createProposalStore } from "../governance/proposal-store.js";
```

Update `src/modules/ingestion/bootstrap-proposal-generator.ts` — the `ProposalStore.create()` now requires `proposedBy` and `knowledgeItemId` and `validationResults`. Update the call:
```typescript
await this.proposals.create({
  ...full,
  proposedBy: "system",
  knowledgeItemId: null,
  validationResults: [],
});
```

- [ ] **Step 4: Run tests — expect PASS** (`npm test -- proposal-store`)

- [ ] **Step 5: Build check** (`npx tsc --noEmit`)

- [ ] **Step 6: Commit**
```bash
git add src/modules/governance/proposal-entities.ts src/modules/governance/proposal-store.ts \
  src/modules/ingestion/entities.ts src/modules/ingestion/proposal-repository.ts \
  src/modules/ingestion/bootstrap-proposal-generator.ts \
  test/modules/governance/proposal-store.test.ts
git commit -m "feat(proposals): replace KnowledgeProposal with full Proposal FSM in governance module"
```

---

### Task 4: Rewrite proposals routes (full FSM, roles, bulk ops)

**Files:**
- Rewrite: `src/routes/proposals.ts`
- Modify: `src/app.ts` (no change needed — already imports proposals route)
- Test: `test/routes/proposals.test.ts` (rewrite)

**Interfaces:**
- Consumes: `createProposalStore` from governance, `requireRole` from actor, `DuplicateDetector`, `ContradictionDetector`
- Produces: 8 proposal endpoints

- [ ] **Step 1: Write failing tests**

```typescript
// test/routes/proposals.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createFakeDb } from "../support/fake-db.js";
import { registerProposalRoutes } from "../../src/routes/proposals.js";
import type { Actor } from "../../src/modules/auth/actor.js";

function buildApp(actor: Actor | undefined = undefined) {
  const { db, rows } = createFakeDb({ proposals: [], conflicts: [], knowledge_items: [], audit_events: [], sources: [] });
  const app = Fastify();
  app.decorate("db", db);
  app.decorate("config", { embedding: null, llm: null });
  app.addHook("onRequest", async (req) => { (req as any).actor = actor; (req as any).projectContext = null; });
  registerProposalRoutes(app as any, { embedding: null, llm: null } as any);
  return { app, rows };
}

const reviewer: Actor = { actorId: "tok_rev", organizationId: "org_1", type: "service", role: "REVIEWER" };
const reader: Actor = { actorId: "tok_read", organizationId: "org_1", type: "service", role: "READER" };

describe("POST /organizations/:orgId/projects/:projectId/proposals", () => {
  it("creates a proposal in VALIDATING status", async () => {
    const { app } = buildApp(reviewer);
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org_1/projects/proj_1/proposals",
      payload: { type: "Decision", title: "Use Redis", summary: "For caching", content: { context: "c", problem: "p", decision: "d" }, triggeredBy: "manual" },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).proposal.status).toBe("VALIDATING");
  });
});

describe("POST .../proposals/:id/approve", () => {
  it("returns 403 for READER role", async () => {
    const { app, rows } = buildApp(reader);
    // seed a proposal
    rows.proposals.push({
      id: "prop_01", organizationId: "org_1", projectId: "proj_1",
      status: "VALIDATING", type: "Decision", title: "T", summary: "S", content: {},
      sourceIds: [], contentHash: "h", triggeredBy: "manual", proposedBy: "tok_1",
      validationResults: [], reviewedBy: null, reviewedAt: null,
      rejectionReason: null, changesFeedback: null, knowledgeItemId: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", proposedAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org_1/projects/proj_1/proposals/prop_01/approve",
    });
    expect(res.statusCode).toBe(403);
  });

  it("REVIEWER can approve and proposal becomes PUBLISHED", async () => {
    const { app, rows } = buildApp(reviewer);
    rows.proposals.push({
      id: "prop_01", organizationId: "org_1", projectId: "proj_1",
      status: "VALIDATING", type: "Decision", title: "T", summary: "S",
      content: { context: "c", problem: "p", decision: "d" },
      sourceIds: [], contentHash: "h", triggeredBy: "manual", proposedBy: "tok_1",
      validationResults: [], reviewedBy: null, reviewedAt: null,
      rejectionReason: null, changesFeedback: null, knowledgeItemId: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", proposedAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org_1/projects/proj_1/proposals/prop_01/approve",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.proposal.status).toBe("PUBLISHED");
    expect(body.knowledgeItem).toBeDefined();
  });
});

describe("POST .../proposals/:id/reject", () => {
  it("requires reason in body", async () => {
    const { app, rows } = buildApp(reviewer);
    rows.proposals.push({
      id: "prop_01", organizationId: "org_1", projectId: "proj_1",
      status: "VALIDATING", type: "Decision", title: "T", summary: "S", content: {},
      sourceIds: [], contentHash: "h", triggeredBy: "manual", proposedBy: "tok_1",
      validationResults: [], reviewedBy: null, reviewedAt: null,
      rejectionReason: null, changesFeedback: null, knowledgeItemId: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", proposedAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "POST",
      url: "/organizations/org_1/projects/proj_1/proposals/prop_01/reject",
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Rewrite `src/routes/proposals.ts`**

Full rewrite using `createProposalStore` from `../modules/governance/proposal-store.js`, `requireRole` from `../modules/auth/actor.js`. Key logic:

```typescript
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/index.js";
import { createProposalStore } from "../modules/governance/proposal-store.js";
import { createConflictStore } from "../modules/governance/conflict-store.js"; // created in task 5
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createKnowledgeVersionStore } from "../modules/knowledge-core/version-repository.js";
import { createAuditEventStore } from "../modules/governance/audit-repository.js";
import { createSourceStore } from "../modules/knowledge-core/source-repository.js";
import { SearchIndexer } from "../modules/retrieval/search-indexer.js";
import { DuplicateDetector } from "../modules/governance/duplicate-detector.js";
import { ContradictionDetector } from "../modules/governance/contradiction-detector.js";
import { requireRole } from "../modules/auth/actor.js";
import { orgIdSchema, projectIdSchema } from "../modules/project-context/entities.js";
import { knowledgeTypeSchema } from "../modules/knowledge-core/entities.js";
import { sourceIdSchema } from "../modules/knowledge-core/source-entities.js";
import { PROPOSAL_STATUSES } from "../modules/governance/proposal-entities.js";
import { z } from "zod";
import {
  DuplicateProposalError, ForbiddenScopeError, InvalidStatusTransitionError,
  NotFoundError, UnauthorizedError, ValidationError,
} from "../lib/errors.js";
import type { ValidationResult } from "../modules/governance/proposal-entities.js";

const proposalIdSchema = z.string().regex(/^prop_[0-9A-HJKMNP-TV-Z]{26}$/);
const nonEmpty = (msg = "required") => z.string().trim().min(1, msg);

const createProposalBodySchema = z.object({
  type: knowledgeTypeSchema,
  title: nonEmpty(),
  summary: nonEmpty(),
  content: z.record(z.unknown()).default({}),
  sourceIds: z.array(sourceIdSchema).default([]),
  triggeredBy: z.enum(["bootstrap", "incremental", "manual"]).default("manual"),
  knowledgeItemId: z.string().nullable().default(null),
}).strict();

const approveBodySchema = z.object({
  content: z.record(z.unknown()).optional(),
}).strict();

const rejectBodySchema = z.object({ reason: nonEmpty("reason is required") }).strict();
const requestChangesBodySchema = z.object({ feedback: nonEmpty("feedback is required") }).strict();
const bulkApproveBodySchema = z.object({ ids: z.array(proposalIdSchema).min(1) }).strict();
const bulkRejectBodySchema = z.object({ ids: z.array(proposalIdSchema).min(1), reason: nonEmpty() }).strict();

function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } }, value: unknown, message: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const detail = r.error?.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ValidationError(detail ?? message);
  }
  return r.data as T;
}

export function registerProposalRoutes(app: FastifyInstance, config: AppConfig): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.post("/organizations/:orgId/projects/:projectId/proposals", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    parseOrThrow(projectIdSchema, projectId, "project id is malformed");
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");

    const body = parseOrThrow(createProposalBodySchema, req.body ?? {}, "invalid body");

    const validationResults: ValidationResult[] = [];

    // Duplicate detection
    const dupDetector = new DuplicateDetector(app.db, config.embedding ?? undefined);
    const dupResult = await dupDetector.detect(orgId, projectId, body.type, body.title, body.summary, body.sourceIds);
    if (dupResult?.duplicate) throw new DuplicateProposalError(`duplicate: ${dupResult.existingId} (${dupResult.reason})`);
    if (dupResult) validationResults.push({ checkType: "duplicate", status: "WARN", message: `similar to ${dupResult.existingId}`, details: dupResult });

    // Contradiction detection
    const contraDetector = new ContradictionDetector(app.db, config.llm ?? undefined, config.embedding ?? undefined);
    const contradictions = await contraDetector.detect(orgId, projectId, body.type, body.title, body.summary, body.content);
    const conflictRecords = [];

    const store = createProposalStore(app.db);
    const proposal = await store.create({
      organizationId: orgId, projectId, type: body.type, title: body.title,
      summary: body.summary, content: body.content, sourceIds: body.sourceIds,
      triggeredBy: body.triggeredBy, proposedBy: actor.actorId,
      knowledgeItemId: body.knowledgeItemId, validationResults,
    });

    // Create ConflictRecords for contradictions
    if (contradictions.length > 0) {
      const conflictStore = createConflictStore(app.db);
      for (const c of contradictions) {
        const cr = await conflictStore.create({
          organizationId: orgId, projectId, proposalId: proposal.id,
          conflictingKnowledgeId: c.conflictingId, explanation: c.explanation,
        });
        conflictRecords.push(cr);
      }
    }

    reply.status(201);
    return { proposal, conflictRecords };
  });

  app.get("/organizations/:orgId/projects/:projectId/proposals", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const { status } = req.query as { status?: string };
    let statusFilter: (typeof PROPOSAL_STATUSES)[number] | undefined;
    if (status) {
      const r = z.enum(PROPOSAL_STATUSES).safeParse(status);
      if (!r.success) throw new ValidationError("invalid status");
      statusFilter = r.data;
    }
    const store = createProposalStore(app.db);
    const proposals = await store.findByProject(orgId, projectId, { status: statusFilter });
    return { proposals, total: proposals.length };
  });

  app.get("/organizations/:orgId/projects/:projectId/proposals/:id", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
    parseOrThrow(proposalIdSchema, id, "proposal id is malformed");
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const store = createProposalStore(app.db);
    const proposal = await store.findById(orgId, id);
    if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
    const conflictStore = createConflictStore(app.db);
    const conflictRecords = await conflictStore.findByProposal(orgId, id);
    return { ...proposal, conflictRecords };
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/:id/approve", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    parseOrThrow(proposalIdSchema, id, "proposal id is malformed");
    const body = approveBodySchema.safeParse(req.body ?? {}).data ?? {};

    const proposalStore = createProposalStore(app.db);
    const proposal = await proposalStore.findById(orgId, id);
    if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
    if (proposal.status !== "VALIDATING") throw new InvalidStatusTransitionError(proposal.status, "PUBLISHED");

    const finalContent = body.content ?? proposal.content;
    const knowledgeStore = createKnowledgeItemStore(app.db);
    const vStore = createKnowledgeVersionStore(app.db);

    let knowledgeItem;
    if (proposal.knowledgeItemId) {
      knowledgeItem = await knowledgeStore.update(orgId, proposal.knowledgeItemId, {
        title: proposal.title, summary: proposal.summary, content: finalContent, status: "PUBLISHED",
      });
    } else {
      knowledgeItem = await knowledgeStore.create({
        organizationId: orgId, projectId, type: proposal.type,
        title: proposal.title, summary: proposal.summary, content: finalContent,
        status: "PUBLISHED", ownerId: proposal.proposedBy,
      });
    }

    if (knowledgeItem) {
      await new SearchIndexer(app.db).upsert(knowledgeItem);
    }

    await createAuditEventStore(app.db).append({
      organizationId: orgId, eventType: "APPROVE",
      targetId: knowledgeItem?.id ?? id, targetType: "knowledge",
      actorId: actor.actorId, actorName: actor.actorId,
    });

    const approved = await proposalStore.approve(orgId, id, actor.actorId, knowledgeItem?.id ?? "");
    return { proposal: approved, knowledgeItem };
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/:id/reject", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    parseOrThrow(proposalIdSchema, id, "proposal id is malformed");
    const { reason } = parseOrThrow(rejectBodySchema, req.body ?? {}, "reason is required");

    const proposalStore = createProposalStore(app.db);
    const proposal = await proposalStore.findById(orgId, id);
    if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
    if (proposal.status !== "VALIDATING") throw new InvalidStatusTransitionError(proposal.status, "REJECTED");

    await createAuditEventStore(app.db).append({
      organizationId: orgId, eventType: "REJECT", targetId: id, targetType: "knowledge",
      actorId: actor.actorId, actorName: actor.actorId, reason,
    });
    return proposalStore.reject(orgId, id, actor.actorId, reason);
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/:id/request-changes", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId, id } = req.params as { orgId: string; projectId: string; id: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    parseOrThrow(proposalIdSchema, id, "proposal id is malformed");
    const { feedback } = parseOrThrow(requestChangesBodySchema, req.body ?? {}, "feedback is required");

    const proposalStore = createProposalStore(app.db);
    const proposal = await proposalStore.findById(orgId, id);
    if (!proposal || proposal.projectId !== projectId) throw new NotFoundError("proposal not found");
    if (proposal.status !== "VALIDATING") throw new InvalidStatusTransitionError(proposal.status, "CHANGES_REQUESTED");

    await createAuditEventStore(app.db).append({
      organizationId: orgId, eventType: "REQUEST_CHANGES", targetId: id, targetType: "knowledge",
      actorId: actor.actorId, actorName: actor.actorId, reason: feedback,
    });
    return proposalStore.requestChanges(orgId, id, actor.actorId, feedback);
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/bulk-approve", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const { ids } = parseOrThrow(bulkApproveBodySchema, req.body ?? {}, "ids required");

    const proposalStore = createProposalStore(app.db);
    // Validate all before modifying any
    const proposals = await Promise.all(ids.map(id => proposalStore.findById(orgId, id)));
    for (const p of proposals) {
      if (!p || p.projectId !== projectId) throw new NotFoundError(`proposal not found`);
      if (p.status !== "VALIDATING") throw new ValidationError(`proposal ${p.id} is not in VALIDATING status`);
    }

    const knowledgeStore = createKnowledgeItemStore(app.db);
    const results = [];
    for (const p of proposals) {
      if (!p) continue;
      const item = await knowledgeStore.create({
        organizationId: orgId, projectId, type: p.type,
        title: p.title, summary: p.summary, content: p.content,
        status: "PUBLISHED", ownerId: p.proposedBy,
      });
      await new SearchIndexer(app.db).upsert(item);
      const approved = await proposalStore.approve(orgId, p.id, actor.actorId, item.id);
      results.push({ id: p.id, status: "approved", knowledgeItemId: item.id });
    }
    reply.status(207);
    return { results };
  });

  app.post("/organizations/:orgId/projects/:projectId/proposals/bulk-reject", BEARER, async (req, reply) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const { ids, reason } = parseOrThrow(bulkRejectBodySchema, req.body ?? {}, "ids and reason required");

    const proposalStore = createProposalStore(app.db);
    const proposals = await Promise.all(ids.map(id => proposalStore.findById(orgId, id)));
    for (const p of proposals) {
      if (!p || p.projectId !== projectId) throw new NotFoundError("proposal not found");
      if (p.status !== "VALIDATING") throw new ValidationError(`proposal ${p?.id} is not in VALIDATING status`);
    }

    const results = [];
    for (const p of proposals) {
      if (!p) continue;
      await proposalStore.reject(orgId, p.id, actor.actorId, reason);
      results.push({ id: p.id, status: "rejected" });
    }
    reply.status(207);
    return { results };
  });
}
```

Note: `createConflictStore` is imported from Task 5 — create a stub file first so TypeScript compiles:
```typescript
// src/modules/governance/conflict-store.ts (stub — filled in Task 5)
export function createConflictStore(_db: unknown) {
  return {
    create: async (_input: unknown) => ({}),
    findByProposal: async (_orgId: string, _proposalId: string) => [],
  };
}
```

- [ ] **Step 4: Run tests — expect PASS** (`npm test -- proposals`)

- [ ] **Step 5: Build check** (`npx tsc --noEmit`)

- [ ] **Step 6: Commit**
```bash
git add src/routes/proposals.ts src/modules/governance/conflict-store.ts test/routes/proposals.test.ts
git commit -m "feat(proposals): rewrite proposal routes with full FSM, roles, bulk ops, request-changes"
```

---

### Task 5: Conflict entities, store, service, and routes

**Files:**
- Create: `src/modules/governance/conflict-entities.ts`
- Rewrite: `src/modules/governance/conflict-store.ts` (from stub)
- Create: `src/routes/conflicts.ts`
- Modify: `src/app.ts` (register conflicts route)
- Test: `test/routes/conflicts.test.ts`

**Interfaces:**
- Produces: `ConflictRecord`, `createConflictStore(db)`, `GET /conflicts`, `POST /conflicts/:id/resolve`
- Consumes: `requireRole`, `KnowledgeItemStore`, `ProposalStore`, `AuditEventStore`

- [ ] **Step 1: Write failing tests**

```typescript
// test/routes/conflicts.test.ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { createFakeDb } from "../support/fake-db.js";
import { registerConflictRoutes } from "../../src/routes/conflicts.js";
import type { Actor } from "../../src/modules/auth/actor.js";

const reviewer: Actor = { actorId: "tok_rev", organizationId: "org_1", type: "service", role: "REVIEWER" };
const reader: Actor = { actorId: "tok_read", organizationId: "org_1", type: "service", role: "READER" };

function buildApp(actor: Actor | undefined) {
  const { db, rows } = createFakeDb({
    conflicts: [], proposals: [], knowledge_items: [], audit_events: [],
  });
  const app = Fastify();
  app.decorate("db", db);
  app.addHook("onRequest", async (req) => { (req as any).actor = actor; });
  registerConflictRoutes(app as any);
  return { app, rows };
}

describe("GET /organizations/:orgId/projects/:projectId/conflicts", () => {
  it("returns empty list", async () => {
    const { app } = buildApp(reviewer);
    const res = await app.inject({ method: "GET", url: "/organizations/org_1/projects/proj_1/conflicts" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).conflicts).toEqual([]);
  });
});

describe("POST /conflicts/:id/resolve", () => {
  it("returns 403 for READER", async () => {
    const { app, rows } = buildApp(reader);
    rows.conflicts.push({
      id: "conf_01", organizationId: "org_1", projectId: "proj_1",
      proposalId: "prop_01", conflictingKnowledgeId: "know_01",
      explanation: "they differ", status: "OPEN", resolution: null,
      mergedContent: null, resolvedBy: null, resolvedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "POST", url: "/conflicts/conf_01/resolve",
      payload: { action: "KEEP_EXISTING" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("KEEP_EXISTING rejects proposal and closes conflict", async () => {
    const { app, rows } = buildApp(reviewer);
    rows.conflicts.push({
      id: "conf_01", organizationId: "org_1", projectId: "proj_1",
      proposalId: "prop_01", conflictingKnowledgeId: "know_01",
      explanation: "they differ", status: "OPEN", resolution: null,
      mergedContent: null, resolvedBy: null, resolvedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    rows.proposals.push({
      id: "prop_01", organizationId: "org_1", projectId: "proj_1",
      status: "VALIDATING", type: "Decision", title: "T", summary: "S", content: {},
      sourceIds: [], contentHash: "h", triggeredBy: "manual", proposedBy: "tok_1",
      validationResults: [], reviewedBy: null, reviewedAt: null,
      rejectionReason: null, changesFeedback: null, knowledgeItemId: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      proposedAt: "2026-01-01T00:00:00.000Z",
    });
    rows.audit_events = [];
    const res = await app.inject({
      method: "POST", url: "/conflicts/conf_01/resolve",
      payload: { action: "KEEP_EXISTING" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("RESOLVED");
    expect(body.resolution).toBe("KEEP_EXISTING");
    expect(rows.proposals[0].status).toBe("REJECTED");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement**

`src/modules/governance/conflict-entities.ts`:
```typescript
import { ulid } from "ulid";

export type ConflictResolution = "KEEP_EXISTING" | "ACCEPT_NEW" | "MERGE";
export type ConflictStatus = "OPEN" | "RESOLVED";

export interface ConflictRecord {
  id: string;
  organizationId: string;
  projectId: string;
  proposalId: string;
  conflictingKnowledgeId: string;
  explanation: string;
  status: ConflictStatus;
  resolution: ConflictResolution | null;
  mergedContent: Record<string, unknown> | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export function newConflictId(): string {
  return `conf_${ulid()}`;
}
```

`src/modules/governance/conflict-store.ts` (full implementation):
```typescript
import type { Db } from "mongodb";
import { newConflictId, type ConflictRecord, type ConflictResolution } from "./conflict-entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

export interface CreateConflictInput {
  organizationId: string;
  projectId: string;
  proposalId: string;
  conflictingKnowledgeId: string;
  explanation: string;
}

export interface ConflictStore {
  create(input: CreateConflictInput): Promise<ConflictRecord>;
  findById(orgId: string, id: string): Promise<ConflictRecord | null>;
  findByProject(orgId: string, projectId: string, filter?: { status?: "OPEN" | "RESOLVED" }): Promise<ConflictRecord[]>;
  findByProposal(orgId: string, proposalId: string): Promise<ConflictRecord[]>;
  resolve(orgId: string, id: string, actorId: string, resolution: ConflictResolution, mergedContent?: Record<string, unknown>): Promise<ConflictRecord | null>;
}

export function createConflictStore(db: Db): ConflictStore {
  const col = () => db.collection<ConflictRecord>("conflicts");

  return {
    async create(input) {
      const now = new Date().toISOString();
      const record: ConflictRecord = {
        id: newConflictId(),
        organizationId: input.organizationId,
        projectId: input.projectId,
        proposalId: input.proposalId,
        conflictingKnowledgeId: input.conflictingKnowledgeId,
        explanation: input.explanation,
        status: "OPEN",
        resolution: null,
        mergedContent: null,
        resolvedBy: null,
        resolvedAt: null,
        createdAt: now,
      };
      await col().insertOne({ ...record });
      return record;
    },

    async findById(orgId, id) {
      return col().findOne({ id, organizationId: orgId }, READ_OPTS) as Promise<ConflictRecord | null>;
    },

    async findByProject(orgId, projectId, filter) {
      const query: Record<string, unknown> = { organizationId: orgId, projectId };
      if (filter?.status) query.status = filter.status;
      return col().find(query as unknown as Partial<ConflictRecord>, READ_OPTS).toArray() as Promise<ConflictRecord[]>;
    },

    async findByProposal(orgId, proposalId) {
      return col().find({ organizationId: orgId, proposalId } as unknown as Partial<ConflictRecord>, READ_OPTS).toArray() as Promise<ConflictRecord[]>;
    },

    async resolve(orgId, id, actorId, resolution, mergedContent) {
      const now = new Date().toISOString();
      return col().findOneAndUpdate(
        { id, organizationId: orgId, status: "OPEN" } as unknown as Partial<ConflictRecord>,
        { $set: { status: "RESOLVED", resolution, mergedContent: mergedContent ?? null, resolvedBy: actorId, resolvedAt: now } },
        { returnDocument: "after", projection: { _id: 0 } },
      ) as Promise<ConflictRecord | null>;
    },
  };
}
```

`src/routes/conflicts.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { createConflictStore } from "../modules/governance/conflict-store.js";
import { createProposalStore } from "../modules/governance/proposal-store.js";
import { createKnowledgeItemStore } from "../modules/knowledge-core/repository.js";
import { createAuditEventStore } from "../modules/governance/audit-repository.js";
import { SearchIndexer } from "../modules/retrieval/search-indexer.js";
import { requireRole } from "../modules/auth/actor.js";
import { orgIdSchema, projectIdSchema } from "../modules/project-context/entities.js";
import { z } from "zod";
import { ForbiddenScopeError, NotFoundError, UnauthorizedError, ValidationError } from "../lib/errors.js";

const conflictIdSchema = z.string().regex(/^conf_[0-9A-HJKMNP-TV-Z]{26}$/);
const resolveBodySchema = z.object({
  action: z.enum(["KEEP_EXISTING", "ACCEPT_NEW", "MERGE"]),
  mergedContent: z.record(z.unknown()).optional(),
}).strict();

function parseOrThrow<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: { path: (string|number)[]; message: string }[] } } }, value: unknown, msg: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ValidationError(r.error?.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") ?? msg);
  return r.data as T;
}

export function registerConflictRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.get("/organizations/:orgId/projects/:projectId/conflicts", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    const { orgId, projectId } = req.params as { orgId: string; projectId: string };
    if (actor.organizationId !== orgId) throw new ForbiddenScopeError("forbidden");
    const { status } = req.query as { status?: string };
    let statusFilter: "OPEN" | "RESOLVED" | undefined;
    if (status === "OPEN" || status === "RESOLVED") statusFilter = status;
    else if (status) throw new ValidationError("status must be OPEN or RESOLVED");
    const store = createConflictStore(app.db);
    const conflicts = await store.findByProject(orgId, projectId, { status: statusFilter });
    return { conflicts, total: conflicts.length };
  });

  app.post("/conflicts/:id/resolve", BEARER, async (req) => {
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError("missing credentials");
    requireRole(actor, "REVIEWER");
    const { id } = req.params as { id: string };
    parseOrThrow(conflictIdSchema, id, "conflict id is malformed");
    const { action, mergedContent } = parseOrThrow(resolveBodySchema, req.body ?? {}, "action required");
    if (action === "MERGE" && !mergedContent) throw new ValidationError("mergedContent required for MERGE resolution");

    const conflictStore = createConflictStore(app.db);
    const conflict = await conflictStore.findById(actor.organizationId, id);
    if (!conflict) throw new NotFoundError("conflict not found");
    if (conflict.status === "RESOLVED") throw new ValidationError("conflict already resolved");

    const proposalStore = createProposalStore(app.db);
    const knowledgeStore = createKnowledgeItemStore(app.db);
    const auditStore = createAuditEventStore(app.db);

    if (action === "KEEP_EXISTING") {
      await proposalStore.reject(actor.organizationId, conflict.proposalId, actor.actorId, "conflict resolved: keep existing");
    } else if (action === "ACCEPT_NEW") {
      const proposal = await proposalStore.findById(actor.organizationId, conflict.proposalId);
      if (proposal) {
        const item = await knowledgeStore.create({
          organizationId: actor.organizationId, projectId: conflict.projectId,
          type: proposal.type, title: proposal.title, summary: proposal.summary,
          content: proposal.content, status: "PUBLISHED", ownerId: proposal.proposedBy,
        });
        await new SearchIndexer(app.db).upsert(item);
        await proposalStore.approve(actor.organizationId, conflict.proposalId, actor.actorId, item.id);
      }
      await knowledgeStore.update(actor.organizationId, conflict.conflictingKnowledgeId, { status: "DEPRECATED" });
    } else if (action === "MERGE") {
      const proposal = await proposalStore.findById(actor.organizationId, conflict.proposalId);
      if (proposal && mergedContent) {
        const item = await knowledgeStore.create({
          organizationId: actor.organizationId, projectId: conflict.projectId,
          type: proposal.type, title: proposal.title, summary: proposal.summary,
          content: mergedContent, status: "PUBLISHED", ownerId: proposal.proposedBy,
        });
        await new SearchIndexer(app.db).upsert(item);
        await proposalStore.approve(actor.organizationId, conflict.proposalId, actor.actorId, item.id);
      }
      await knowledgeStore.update(actor.organizationId, conflict.conflictingKnowledgeId, { status: "DEPRECATED" });
    }

    await auditStore.append({
      organizationId: actor.organizationId, eventType: "RESOLVE_CONFLICT",
      targetId: id, targetType: "knowledge",
      actorId: actor.actorId, actorName: actor.actorId, reason: action,
    });

    return conflictStore.resolve(actor.organizationId, id, actor.actorId, action, mergedContent);
  });
}
```

Update `src/app.ts`:
```typescript
import { registerConflictRoutes } from "./routes/conflicts.js";
// In buildApp:
registerConflictRoutes(app);
```

- [ ] **Step 4: Run tests — expect PASS** (`npm test -- conflicts`)

- [ ] **Step 5: Build check** (`npx tsc --noEmit`)

- [ ] **Step 6: Commit**
```bash
git add src/modules/governance/conflict-entities.ts src/modules/governance/conflict-store.ts \
  src/routes/conflicts.ts src/app.ts test/routes/conflicts.test.ts
git commit -m "feat(conflicts): ConflictRecord entity, store, and resolve endpoint"
```

---

### Task 6: MCP server foundation

**Files:**
- Create: `src/modules/mcp/server.ts`
- Create: `src/modules/mcp/transports.ts`
- Create: `src/modules/mcp/tool-registry.ts`
- Create: `src/mcp-server.ts`
- Modify: `package.json` (add `start:mcp` script, add `@modelcontextprotocol/sdk` dep)
- Test: `test/modules/mcp/tool-registry.test.ts`

**Interfaces:**
- Produces: MCP server responding to `initialize`, `tools/list`, `tools/call`; health endpoint; stdio + HTTP/SSE transports

- [ ] **Step 1: Install MCP SDK**
```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Write failing test**

```typescript
// test/modules/mcp/tool-registry.test.ts
import { describe, it, expect } from "vitest";
import { loadToolRegistry } from "../../../src/modules/mcp/tool-registry.js";

describe("ToolRegistry", () => {
  it("loads all three tool schemas from specs/mcp/tools/", async () => {
    const registry = await loadToolRegistry();
    const names = registry.map(t => t.name);
    expect(names).toContain("knowledge.search");
    expect(names).toContain("knowledge.propose");
    expect(names).toContain("knowledge.impact");
  });

  it("each tool has a name and inputSchema", async () => {
    const registry = await loadToolRegistry();
    for (const tool of registry) {
      expect(tool.name).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

- [ ] **Step 4: Implement tool-registry**

`src/modules/mcp/tool-registry.ts`:
```typescript
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const TOOLS_DIR = join(__dirname, "../../../specs/mcp/tools");

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export async function loadToolRegistry(): Promise<ToolSchema[]> {
  const files = (await readdir(TOOLS_DIR)).filter(f => f.endsWith(".json"));
  const tools: ToolSchema[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(TOOLS_DIR, file), "utf-8"));
    // Normalise both spec shapes: {title, properties} and {name, inputSchema}
    tools.push({
      name: raw.name ?? raw.title,
      description: raw.description,
      inputSchema: raw.inputSchema ?? { type: "object", properties: raw.properties ?? {}, required: raw.required ?? [] },
    });
  }
  return tools;
}
```

- [ ] **Step 5: Run test — expect PASS**

- [ ] **Step 6: Implement MCP server**

`src/modules/mcp/server.ts`:
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "mongodb";
import type { AppConfig } from "../../config/index.js";
import { loadToolRegistry } from "./tool-registry.js";
import { handleToolCall } from "./tools/dispatcher.js";

export async function createMcpServer(db: Db, config: AppConfig): Promise<Server> {
  const tools = await loadToolRegistry();
  const server = new Server(
    { name: "project-memory", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args ?? {}, db, config);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });

  return server;
}
```

`src/modules/mcp/tools/dispatcher.ts`:
```typescript
import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  switch (name) {
    case "knowledge.search": {
      const { searchKnowledge } = await import("./search.js");
      return searchKnowledge(args, db, config);
    }
    case "knowledge.propose": {
      const { proposeKnowledge } = await import("./propose.js");
      return proposeKnowledge(args, db, config);
    }
    case "knowledge.impact": {
      const { analyzeImpact } = await import("./impact.js");
      return analyzeImpact(args, db, config);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
```

`src/mcp-server.ts`:
```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/index.js";
import { connectMongo } from "./lib/mongo.js";
import { ensureIndexes } from "./lib/indexes.js";
import { createMcpServer } from "./modules/mcp/server.js";

async function main() {
  const config = loadConfig();
  const db = await connectMongo(config);
  await ensureIndexes(db);
  const server = await createMcpServer(db, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Project Memory MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err}\n`);
  process.exit(1);
});
```

Add to `package.json` scripts:
```json
"start:mcp": "node --experimental-vm-modules dist/mcp-server.js"
```

- [ ] **Step 7: Build check** (`npx tsc --noEmit`)

- [ ] **Step 8: Run tests** (`npm test -- tool-registry`)

- [ ] **Step 9: Commit**
```bash
git add src/modules/mcp/ src/mcp-server.ts package.json package-lock.json \
  test/modules/mcp/tool-registry.test.ts
git commit -m "feat(mcp): MCP server foundation — tool registry, stdio transport, tools/list"
```

---

### Task 7: MCP tools — search, propose, impact

**Files:**
- Create: `src/modules/mcp/tools/search.ts`
- Create: `src/modules/mcp/tools/propose.ts`
- Create: `src/modules/mcp/tools/impact.ts`
- Test: `test/modules/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `HybridRetriever`, `VectorSearchService`, `ProposalService` (from governance), `ImpactAnalyzer`
- Produces: tool handler functions matching MCP tool spec input/output schemas

- [ ] **Step 1: Write failing tests**

```typescript
// test/modules/mcp/tools.test.ts
import { describe, it, expect } from "vitest";
import { createFakeDb } from "../../support/fake-db.js";
import { searchKnowledge } from "../../../src/modules/mcp/tools/search.js";
import { analyzeImpact } from "../../../src/modules/mcp/tools/impact.js";

describe("MCP searchKnowledge tool", () => {
  it("returns empty results for empty index", async () => {
    const { db } = createFakeDb({ search_records: [], knowledge_items: [] });
    const result = await searchKnowledge(
      { query: "database schema" },
      db,
      { embedding: null, llm: null } as any,
    );
    expect(result).toHaveProperty("results");
    expect(Array.isArray((result as any).results)).toBe(true);
  });

  it("throws for missing query", async () => {
    const { db } = createFakeDb({});
    await expect(searchKnowledge({}, db, {} as any)).rejects.toThrow();
  });
});

describe("MCP analyzeImpact tool", () => {
  it("returns empty impacts for unknown item", async () => {
    const { db } = createFakeDb({ knowledge_items: [], relations: [] });
    const result = await analyzeImpact(
      { componentId: "know_01AAAAAAAAAAAAAAAAAAAAAAAAA", projectId: "proj_1" },
      db,
      { embedding: null } as any,
    );
    expect(result).toHaveProperty("impacts");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement tools**

`src/modules/mcp/tools/search.ts`:
```typescript
import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";
import { HybridRetriever } from "../../retrieval/hybrid-retriever.js";
import { SearchIndexer } from "../../retrieval/search-indexer.js";
import { VectorSearchService } from "../../retrieval/vector-search.js";

export async function searchKnowledge(
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  const query = args.query;
  if (typeof query !== "string" || query.trim().length === 0) throw new Error("query is required");
  const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 10;

  const indexer = new SearchIndexer(db);
  const vectorSearch = new VectorSearchService(db, config.embedding);
  const retriever = new HybridRetriever(indexer, vectorSearch);

  const results = await retriever.search({
    orgId: typeof args.orgId === "string" ? args.orgId : "",
    query: query.trim(),
    projectId: projectId ?? "",
    limit,
  });
  return { results };
}
```

`src/modules/mcp/tools/propose.ts`:
```typescript
import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";
import { createProposalStore } from "../../governance/proposal-store.js";
import { DuplicateDetector } from "../../governance/duplicate-detector.js";
import { ContradictionDetector } from "../../governance/contradiction-detector.js";

export async function proposeKnowledge(
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  const { type, title, content, orgId, projectId } = args as Record<string, string>;
  if (!type || !title || !content) throw new Error("type, title, and content are required");

  const summary = typeof args.summary === "string" ? args.summary : title;
  const sourceIds = Array.isArray(args.sourceIds) ? (args.sourceIds as string[]) : [];

  const dupDetector = new DuplicateDetector(db, config.embedding ?? undefined);
  const dupResult = await dupDetector.detect(orgId, projectId, type, title, summary, sourceIds);
  if (dupResult?.duplicate) throw new Error(`Duplicate detected: ${dupResult.existingId}`);

  const contraDetector = new ContradictionDetector(db, config.llm ?? undefined, config.embedding ?? undefined);
  const contradictions = await contraDetector.detect(orgId, projectId, type, title, summary, content as unknown as Record<string, unknown>);

  const store = createProposalStore(db);
  const proposal = await store.create({
    organizationId: orgId, projectId, type: type as any, title, summary,
    content: content as unknown as Record<string, unknown>,
    sourceIds, triggeredBy: "manual", proposedBy: "mcp-agent",
    knowledgeItemId: null, validationResults: [],
  });

  return { proposal, contradictions };
}
```

`src/modules/mcp/tools/impact.ts`:
```typescript
import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";
import { ImpactAnalyzer } from "../../retrieval/impact-analyzer.js";

export async function analyzeImpact(
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  const componentId = args.componentId;
  const projectId = args.projectId;
  if (typeof componentId !== "string") throw new Error("componentId is required");
  if (typeof projectId !== "string") throw new Error("projectId is required");

  const analyzer = new ImpactAnalyzer(db, config.embedding ?? undefined);
  const orgId = typeof args.orgId === "string" ? args.orgId : "";
  const impacts = await analyzer.analyze(orgId, componentId, projectId);
  return { componentId, impacts };
}
```

- [ ] **Step 4: Run tests — expect PASS** (`npm test -- tools`)

- [ ] **Step 5: Full test suite** (`npm test`)

- [ ] **Step 6: Build check** (`npx tsc --noEmit`)

- [ ] **Step 7: Commit**
```bash
git add src/modules/mcp/tools/ test/modules/mcp/tools.test.ts
git commit -m "feat(mcp): implement knowledge.search, knowledge.propose, knowledge.impact MCP tools"
```

---

## Execution order summary

```
Task 1 (auth roles)  ─┐
                       ├─ both independent, run in parallel
Task 2 (freshness)   ─┘

Task 3 (proposal entity)   → after Task 1
Task 4 (proposal routes)   → after Task 3
Task 5 (conflicts)         → after Task 4
Task 6 (MCP foundation)    → after Task 4
Task 7 (MCP tools)         → after Task 6
```
