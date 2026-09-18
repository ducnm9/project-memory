# PM-004 Authentication & Service Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every request an authenticated `actor` resolved from a PM-issued service token before tenant resolution, and constrain each caller to a single organization.

**Architecture:** A new `auth` module (secret generation/hashing, token persistence, actor resolution) feeds a Fastify `authentication` plugin that runs *before* the existing `tenant-context` plugin. Each route declares `config.auth` (`public` | `admin` | `bearer`, default `bearer`); the plugin enforces the policy and decorates `request.actor`. Tenant-context is extended to force the requested org to equal the token's org. Token management + org creation are gated by an admin bootstrap key.

**Tech Stack:** TypeScript (ESM, NodeNext), Fastify 5, MongoDB 7 driver, Zod 3, `ulid` 2.3, Node built-in `crypto` (no new dependency), Vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-18-pm-004-authentication-and-service-identity-design.md`

## Global Constraints

- Node `>=20.19.0`; ESM (`"type": "module"`) — all relative imports end in `.js`.
- No new dependency. Token secrets use Node's built-in `crypto`; ids use the existing `ulid` 2.3.0.
- Error responses use the existing nested shape: `{ error: { code, message } }` (see `src/plugins/error-handler.ts`). All errors thrown are subclasses of `AppError` (`src/lib/errors.ts`).
- Ids are prefixed ULIDs: `tok_<26-char Crockford base32>`. Validate with Zod at trust boundaries.
- Secret format: `pmk_` + base64url of ≥32 random bytes. Stored `prefix` = `pmk_` + first 8 chars of the random part. DB stores only `hashedSecret` = hex HMAC-SHA-256(secret, pepper).
- Config parsed with Zod in `src/config/index.ts`; `AUTH_ADMIN_KEY` and `AUTH_TOKEN_PEPPER` are required in production, optional in dev/test.
- Tests: Vitest, `app.inject` for HTTP, mock `Db` via `{ collection: (name) => handler }`. Run a single test with `npx vitest run <path> -t "<name>"`.
- Commit after each task with the message shown in its final step.

---

### Task 1: Config — admin key and token pepper

**Files:**
- Modify: `src/config/index.ts`
- Modify: `.env.example`
- Test: `test/config/index.test.ts`

**Interfaces:**
- Consumes: existing `loadConfig(env)` returning a frozen `AppConfig`.
- Produces: `AppConfig` gains `authAdminKey: string` and `authTokenPepper: string`. In production both are required (throw if missing/empty); in dev/test they default to empty string `""`.

- [ ] **Step 1: Write the failing tests**

Add to `test/config/index.test.ts`:

```typescript
  it("defaults auth admin key and pepper to empty in development", () => {
    const cfg = loadConfig({ MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB_NAME: "pm" });
    expect(cfg.authAdminKey).toBe("");
    expect(cfg.authTokenPepper).toBe("");
  });

  it("reads auth admin key and pepper when provided", () => {
    const cfg = loadConfig({
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB_NAME: "pm",
      AUTH_ADMIN_KEY: "admin-secret",
      AUTH_TOKEN_PEPPER: "pepper-secret",
    });
    expect(cfg.authAdminKey).toBe("admin-secret");
    expect(cfg.authTokenPepper).toBe("pepper-secret");
  });

  it("fails fast when AUTH_ADMIN_KEY is missing in production", () => {
    expect(() =>
      loadConfig({
        MONGODB_URI: "mongodb://localhost:27017",
        MONGODB_DB_NAME: "pm",
        NODE_ENV: "production",
        AUTH_TOKEN_PEPPER: "p",
      }),
    ).toThrow(/AUTH_ADMIN_KEY/);
  });

  it("fails fast when AUTH_TOKEN_PEPPER is missing in production", () => {
    expect(() =>
      loadConfig({
        MONGODB_URI: "mongodb://localhost:27017",
        MONGODB_DB_NAME: "pm",
        NODE_ENV: "production",
        AUTH_ADMIN_KEY: "a",
      }),
    ).toThrow(/AUTH_TOKEN_PEPPER/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/config/index.test.ts`
Expected: FAIL — `cfg.authAdminKey` is undefined; production cases do not throw.

- [ ] **Step 3: Implement config changes**

In `src/config/index.ts`, add fields to the `AppConfig` interface:

```typescript
export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
  logLevel: string;
  mongodbUri: string;
  mongodbDbName: string;
  authAdminKey: string;
  authTokenPepper: string;
}
```

Add the two vars to the Zod `schema` object (optional strings, default empty):

```typescript
  AUTH_ADMIN_KEY: z.string().default(""),
  AUTH_TOKEN_PEPPER: z.string().default(""),
```

After the existing `if (!parsed.success)` block, add a production requirement check before building the frozen object:

```typescript
  const data = parsed.data;
  if (data.NODE_ENV === "production") {
    const missing: string[] = [];
    if (data.AUTH_ADMIN_KEY.length === 0) missing.push("AUTH_ADMIN_KEY");
    if (data.AUTH_TOKEN_PEPPER.length === 0) missing.push("AUTH_TOKEN_PEPPER");
    if (missing.length > 0) {
      throw new Error(`Invalid configuration: ${missing.join(", ")} required in production`);
    }
  }
```

Add both fields to the returned `Object.freeze({ ... })`:

```typescript
    authAdminKey: data.AUTH_ADMIN_KEY,
    authTokenPepper: data.AUTH_TOKEN_PEPPER,
```

- [ ] **Step 4: Update `.env.example`**

Append to `.env.example`:

```
# Admin bootstrap key gating org creation and token management (required in production).
AUTH_ADMIN_KEY=
# Server-side pepper for HMAC-SHA-256 token hashing (required in production).
AUTH_TOKEN_PEPPER=
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/config/index.test.ts`
Expected: PASS (all, including the pre-existing cases).

- [ ] **Step 6: Commit**

```bash
git add src/config/index.ts .env.example test/config/index.test.ts
git commit -m "feat(pm-004): add auth admin key and token pepper config"
```

---

### Task 2: Error classes — Unauthorized and ForbiddenScope

**Files:**
- Modify: `src/lib/errors.ts`
- Test: `test/lib/errors.test.ts`

**Interfaces:**
- Consumes: existing `AppError(message, statusCode, code)` base class.
- Produces: `UnauthorizedError` (statusCode `401`, code `UNAUTHORIZED`) and `ForbiddenScopeError` (statusCode `403`, code `FORBIDDEN_SCOPE`), both taking a `message: string`.

- [ ] **Step 1: Write the failing tests**

Add to `test/lib/errors.test.ts`:

```typescript
import { UnauthorizedError, ForbiddenScopeError } from "../../src/lib/errors.js";

describe("UnauthorizedError", () => {
  it("has status 401 and code UNAUTHORIZED", () => {
    const e = new UnauthorizedError("invalid credentials");
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("UNAUTHORIZED");
    expect(e.message).toBe("invalid credentials");
  });
});

describe("ForbiddenScopeError", () => {
  it("has status 403 and code FORBIDDEN_SCOPE", () => {
    const e = new ForbiddenScopeError("token not permitted for this organization");
    expect(e.statusCode).toBe(403);
    expect(e.code).toBe("FORBIDDEN_SCOPE");
  });
});
```

> If `test/lib/errors.test.ts` already imports specific names at the top, merge these imports into the existing import line rather than adding a duplicate.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/lib/errors.test.ts`
Expected: FAIL — `UnauthorizedError`/`ForbiddenScopeError` are not exported.

- [ ] **Step 3: Implement the error classes**

Append to `src/lib/errors.ts`:

```typescript
export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenScopeError extends AppError {
  constructor(message: string) {
    super(message, 403, "FORBIDDEN_SCOPE");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/lib/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts test/lib/errors.test.ts
git commit -m "feat(pm-004): add UnauthorizedError and ForbiddenScopeError"
```

---

### Task 3: Secret generation and hashing

**Files:**
- Create: `src/modules/auth/secret.ts`
- Test: `test/modules/auth/secret.test.ts`

**Interfaces:**
- Consumes: Node built-in `crypto` (`randomBytes`, `createHmac`).
- Produces:
  - `generateSecret(): { secret: string; prefix: string }` — `secret` is `pmk_<base64url of 32 random bytes>`; `prefix` is `pmk_` + first 8 chars of the base64url random part.
  - `hashSecret(secret: string, pepper: string): string` — hex HMAC-SHA-256 of `secret` keyed by `pepper`.
  - `SECRET_PREFIX = "pmk_"` constant.

- [ ] **Step 1: Write the failing test**

Create `test/modules/auth/secret.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateSecret, hashSecret, SECRET_PREFIX } from "../../../src/modules/auth/secret.js";

describe("generateSecret", () => {
  it("produces a pmk_-prefixed secret and a matching 12-char prefix", () => {
    const { secret, prefix } = generateSecret();
    expect(secret.startsWith(SECRET_PREFIX)).toBe(true);
    // prefix = "pmk_" (4) + 8 chars of the random part
    expect(prefix).toHaveLength(12);
    expect(secret.startsWith(prefix)).toBe(true);
  });

  it("produces unique secrets", () => {
    expect(generateSecret().secret).not.toBe(generateSecret().secret);
  });
});

describe("hashSecret", () => {
  it("is deterministic for the same secret and pepper", () => {
    expect(hashSecret("pmk_abc", "pepper")).toBe(hashSecret("pmk_abc", "pepper"));
  });

  it("differs when the pepper differs", () => {
    expect(hashSecret("pmk_abc", "p1")).not.toBe(hashSecret("pmk_abc", "p2"));
  });

  it("differs when the secret differs", () => {
    expect(hashSecret("pmk_a", "p")).not.toBe(hashSecret("pmk_b", "p"));
  });

  it("returns a 64-char hex string (sha256)", () => {
    expect(hashSecret("pmk_abc", "p")).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/auth/secret.test.ts`
Expected: FAIL — module `src/modules/auth/secret.ts` does not exist.

- [ ] **Step 3: Implement `secret.ts`**

Create `src/modules/auth/secret.ts`:

```typescript
import { createHmac, randomBytes } from "node:crypto";

export const SECRET_PREFIX = "pmk_";

/**
 * Generate a service-token secret. The plaintext `secret` is returned to the
 * caller exactly once; only its hash is persisted. `prefix` is a non-secret
 * display identifier: SECRET_PREFIX + the first 8 chars of the random part.
 */
export function generateSecret(): { secret: string; prefix: string } {
  const random = randomBytes(32).toString("base64url");
  const secret = `${SECRET_PREFIX}${random}`;
  const prefix = `${SECRET_PREFIX}${random.slice(0, 8)}`;
  return { secret, prefix };
}

/** Hex HMAC-SHA-256 of the secret keyed by the server-side pepper. */
export function hashSecret(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/auth/secret.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/secret.ts test/modules/auth/secret.test.ts
git commit -m "feat(pm-004): add service-token secret generation and hashing"
```

---

### Task 4: Token entity and id generation

**Files:**
- Create: `src/modules/auth/entities.ts`
- Test: `test/modules/auth/entities.test.ts`

**Interfaces:**
- Consumes: `ulid` 2.3.0.
- Produces:
  - `interface ServiceToken { id: string; organizationId: string; name: string; prefix: string; hashedSecret: string; createdAt: string; revokedAt: string | null }`
  - `tokenIdSchema` — Zod schema for `tok_<26 Crockford base32>`.
  - `createTokenBodySchema` — Zod object `{ name: string (trimmed, min 1) }`.
  - `newTokenId(): string` returning `tok_<ulid>`.

- [ ] **Step 1: Write the failing test**

Create `test/modules/auth/entities.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { newTokenId, tokenIdSchema, createTokenBodySchema } from "../../../src/modules/auth/entities.js";

describe("newTokenId", () => {
  it("produces a tok_-prefixed id that passes tokenIdSchema", () => {
    const id = newTokenId();
    expect(id).toMatch(/^tok_/);
    expect(tokenIdSchema.safeParse(id).success).toBe(true);
  });
});

describe("tokenIdSchema", () => {
  it("rejects a malformed id", () => {
    expect(tokenIdSchema.safeParse("tok_bad").success).toBe(false);
    expect(tokenIdSchema.safeParse("nope").success).toBe(false);
  });
});

describe("createTokenBodySchema", () => {
  it("accepts a non-empty name and trims it", () => {
    const r = createTokenBodySchema.safeParse({ name: "  kiro-ci  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("kiro-ci");
  });

  it("rejects an empty name", () => {
    expect(createTokenBodySchema.safeParse({ name: " " }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/auth/entities.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `entities.ts`**

Create `src/modules/auth/entities.ts`:

```typescript
import { ulid } from "ulid";
import { z } from "zod";

export interface ServiceToken {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  hashedSecret: string;
  createdAt: string;
  revokedAt: string | null;
}

// Crockford base32 (ULID alphabet): no I, L, O, U.
export const tokenIdSchema = z.string().regex(/^tok_[0-9A-HJKMNP-TV-Z]{26}$/);

const nameSchema = z.string().trim().min(1);
export const createTokenBodySchema = z.object({ name: nameSchema });

export function newTokenId(): string {
  return `tok_${ulid()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/auth/entities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/entities.ts test/modules/auth/entities.test.ts
git commit -m "feat(pm-004): add ServiceToken entity and id generation"
```

---

### Task 5: Token repository

**Files:**
- Create: `src/modules/auth/repository.ts`
- Test: `test/modules/auth/repository.test.ts`

**Interfaces:**
- Consumes: `Db` (mongodb); `ServiceToken`, `newTokenId` (Task 4); `generateSecret`, `hashSecret` (Task 3).
- Produces `createTokenRepository(db: Db, pepper: string): TokenRepository` where:
  - `createToken(organizationId: string, name: string): Promise<{ token: ServiceToken; secret: string }>` — generates a secret, stores the hash, returns the stored token plus the one-time plaintext `secret`.
  - `findActiveByHash(hashedSecret: string): Promise<ServiceToken | null>` — returns the token only if it exists and `revokedAt` is null.
  - `listTokens(organizationId: string): Promise<Omit<ServiceToken, "hashedSecret">[]>` — never returns `hashedSecret`.
  - `revokeToken(organizationId: string, id: string): Promise<boolean>` — sets `revokedAt`; returns true if a token was updated.

- [ ] **Step 1: Write the failing test**

Create `test/modules/auth/repository.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createTokenRepository } from "../../../src/modules/auth/repository.js";
import { newOrgId } from "../../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function dbWith(serviceTokens: Record<string, unknown>): Db {
  return { collection: (n: string) => (n === "service_tokens" ? serviceTokens : {}) } as unknown as Db;
}

describe("createToken", () => {
  it("stores a hashed secret and returns the one-time plaintext secret", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const repo = createTokenRepository(dbWith({ insertOne }), "pepper");
    const { token, secret } = await repo.createToken(orgId, "kiro-ci");
    expect(secret).toMatch(/^pmk_/);
    expect(token.id).toMatch(/^tok_/);
    expect(token.organizationId).toBe(orgId);
    expect(token.name).toBe("kiro-ci");
    expect(token.revokedAt).toBeNull();
    // stored doc has a hash, never the plaintext
    const stored = insertOne.mock.calls[0][0];
    expect(stored.hashedSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secret);
  });
});

describe("findActiveByHash", () => {
  it("queries by hash AND revokedAt null", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const repo = createTokenRepository(dbWith({ findOne }), "pepper");
    await repo.findActiveByHash("deadbeef");
    expect(findOne).toHaveBeenCalledWith(
      { hashedSecret: "deadbeef", revokedAt: null },
      expect.anything(),
    );
  });
});

describe("listTokens", () => {
  it("projects away the hashedSecret", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const repo = createTokenRepository(dbWith({ find }), "pepper");
    await repo.listTokens(orgId);
    expect(find).toHaveBeenCalledWith({ organizationId: orgId }, expect.anything());
    const projection = find.mock.calls[0][1].projection;
    expect(projection.hashedSecret).toBe(0);
  });
});

describe("revokeToken", () => {
  it("returns true when a token is updated", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const repo = createTokenRepository(dbWith({ updateOne }), "pepper");
    const ok = await repo.revokeToken(orgId, "tok_x");
    expect(ok).toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { id: "tok_x", organizationId: orgId, revokedAt: null },
      { $set: { revokedAt: expect.any(String) } },
    );
  });

  it("returns false when nothing matched", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const repo = createTokenRepository(dbWith({ updateOne }), "pepper");
    expect(await repo.revokeToken(orgId, "tok_x")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/auth/repository.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `repository.ts`**

Create `src/modules/auth/repository.ts`:

```typescript
import type { Db } from "mongodb";
import { newTokenId, type ServiceToken } from "./entities.js";
import { generateSecret, hashSecret } from "./secret.js";

const READ_OPTS = { projection: { _id: 0 } } as const;
const LIST_OPTS = { projection: { _id: 0, hashedSecret: 0 } } as const;

export type PublicToken = Omit<ServiceToken, "hashedSecret">;

export interface TokenRepository {
  createToken(organizationId: string, name: string): Promise<{ token: ServiceToken; secret: string }>;
  findActiveByHash(hashedSecret: string): Promise<ServiceToken | null>;
  listTokens(organizationId: string): Promise<PublicToken[]>;
  revokeToken(organizationId: string, id: string): Promise<boolean>;
}

export function createTokenRepository(db: Db, pepper: string): TokenRepository {
  const col = () => db.collection<ServiceToken>("service_tokens");

  return {
    async createToken(organizationId, name) {
      const { secret, prefix } = generateSecret();
      const token: ServiceToken = {
        id: newTokenId(),
        organizationId,
        name,
        prefix,
        hashedSecret: hashSecret(secret, pepper),
        createdAt: new Date().toISOString(),
        revokedAt: null,
      };
      await col().insertOne(token);
      return { token, secret };
    },
    async findActiveByHash(hashedSecret) {
      return col().findOne({ hashedSecret, revokedAt: null }, READ_OPTS) as Promise<ServiceToken | null>;
    },
    async listTokens(organizationId) {
      return col().find({ organizationId }, LIST_OPTS).toArray() as Promise<PublicToken[]>;
    },
    async revokeToken(organizationId, id) {
      const res = await col().updateOne(
        { id, organizationId, revokedAt: null },
        { $set: { revokedAt: new Date().toISOString() } },
      );
      return res.matchedCount > 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/auth/repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/repository.ts test/modules/auth/repository.test.ts
git commit -m "feat(pm-004): add service-token repository"
```

---

### Task 6: Actor resolution

**Files:**
- Create: `src/modules/auth/actor.ts`
- Test: `test/modules/auth/actor.test.ts`

**Interfaces:**
- Consumes: `TokenRepository.findActiveByHash` (Task 5); `hashSecret` (Task 3); `UnauthorizedError` (Task 2).
- Produces:
  - `interface Actor { actorId: string; organizationId: string; type: "service" }`
  - `parseBearer(header: string | undefined): string` — returns the raw secret from an `Authorization: Bearer <secret>` header; throws `UnauthorizedError("missing or malformed credentials")` if absent/malformed.
  - `resolveActor(repo: TokenRepository, pepper: string, header: string | undefined): Promise<Actor>` — parses the bearer, hashes with pepper, looks up an active token, returns an `Actor`, or throws `UnauthorizedError("invalid credentials")` when no active token matches.

- [ ] **Step 1: Write the failing test**

Create `test/modules/auth/actor.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseBearer, resolveActor } from "../../../src/modules/auth/actor.js";
import type { TokenRepository } from "../../../src/modules/auth/repository.js";
import type { ServiceToken } from "../../../src/modules/auth/entities.js";
import { newOrgId } from "../../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function repoReturning(token: ServiceToken | null): TokenRepository {
  return {
    createToken: async () => { throw new Error("unused"); },
    findActiveByHash: async () => token,
    listTokens: async () => [],
    revokeToken: async () => false,
  };
}

describe("parseBearer", () => {
  it("extracts the secret from a Bearer header", () => {
    expect(parseBearer("Bearer pmk_abc")).toBe("pmk_abc");
  });

  it("throws on a missing header", () => {
    expect(() => parseBearer(undefined)).toThrow(/missing or malformed/);
  });

  it("throws on a non-Bearer scheme", () => {
    expect(() => parseBearer("Basic abc")).toThrow(/missing or malformed/);
  });
});

describe("resolveActor", () => {
  it("returns a service actor for an active token", async () => {
    const token: ServiceToken = {
      id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x",
      hashedSecret: "h", createdAt: "", revokedAt: null,
    };
    const actor = await resolveActor(repoReturning(token), "pepper", "Bearer pmk_abc");
    expect(actor).toEqual({ actorId: "tok_x", organizationId: orgId, type: "service" });
  });

  it("throws invalid credentials when no active token matches", async () => {
    await expect(resolveActor(repoReturning(null), "pepper", "Bearer pmk_abc")).rejects.toThrow(
      /invalid credentials/,
    );
  });

  it("throws missing/malformed when the header is absent", async () => {
    await expect(resolveActor(repoReturning(null), "pepper", undefined)).rejects.toThrow(
      /missing or malformed/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/modules/auth/actor.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `actor.ts`**

Create `src/modules/auth/actor.ts`:

```typescript
import { UnauthorizedError } from "../../lib/errors.js";
import { hashSecret } from "./secret.js";
import type { TokenRepository } from "./repository.js";

export interface Actor {
  actorId: string;
  organizationId: string;
  type: "service";
}

const BEARER = "Bearer ";

export function parseBearer(header: string | undefined): string {
  if (header === undefined || !header.startsWith(BEARER)) {
    throw new UnauthorizedError("missing or malformed credentials");
  }
  const secret = header.slice(BEARER.length).trim();
  if (secret.length === 0) {
    throw new UnauthorizedError("missing or malformed credentials");
  }
  return secret;
}

export async function resolveActor(
  repo: TokenRepository,
  pepper: string,
  header: string | undefined,
): Promise<Actor> {
  const secret = parseBearer(header);
  const token = await repo.findActiveByHash(hashSecret(secret, pepper));
  if (!token) {
    throw new UnauthorizedError("invalid credentials");
  }
  return { actorId: token.id, organizationId: token.organizationId, type: "service" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/modules/auth/actor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/actor.ts test/modules/auth/actor.test.ts
git commit -m "feat(pm-004): add actor resolution from bearer token"
```

---

### Task 7: Authentication plugin (per-route policy)

**Files:**
- Create: `src/plugins/authentication.ts`
- Test: `test/plugins/authentication.test.ts`

**Interfaces:**
- Consumes: `resolveActor`, `Actor` (Task 6); `createTokenRepository` (Task 5); `UnauthorizedError` (Task 2); `AppConfig` (`authAdminKey`, `authTokenPepper`).
- Produces:
  - Fastify augmentation: `FastifyRequest.actor?: Actor` and route config field `auth?: "public" | "admin" | "bearer"`.
  - `registerAuthentication(app: FastifyInstance, config: AppConfig): void` — an `onRequest` hook. Reads `request.routeOptions.config.auth` (default `"bearer"`). `public` → skip. `admin` → require `x-admin-key` header to equal `config.authAdminKey`, else `UnauthorizedError("invalid admin credentials")`; no actor. `bearer` → `resolveActor` and set `request.actor`.

- [ ] **Step 1: Write the failing test**

Create `test/plugins/authentication.test.ts`:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { registerAuthentication } from "../../src/plugins/authentication.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import type { AppConfig } from "../../src/config/index.js";

const config = { authAdminKey: "admin-secret", authTokenPepper: "pepper" } as AppConfig;

// A token whose hash matches hashSecret("pmk_good", "pepper").
function dbWithToken(match: boolean): Db {
  return {
    collection: () => ({
      findOne: async (filter: { hashedSecret: string; revokedAt: null }) =>
        match && filter.revokedAt === null
          ? { id: "tok_x", organizationId: "org_1", name: "n", prefix: "pmk_x", hashedSecret: filter.hashedSecret, createdAt: "", revokedAt: null }
          : null,
    }),
  } as unknown as Db;
}

function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerErrorHandler(app);
  registerAuthentication(app, config);
  app.get("/pub", { config: { auth: "public" } }, async () => ({ ok: true }));
  app.get("/adm", { config: { auth: "admin" } }, async () => ({ ok: true }));
  app.get("/bear", { config: { auth: "bearer" } }, async (req) => ({ actor: req.actor ?? null }));
  app.get("/def", async (req) => ({ actor: req.actor ?? null })); // no config → default bearer
  return app;
}

describe("authentication plugin", () => {
  it("public routes skip auth and set no actor", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/pub" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("admin route rejects a missing/wrong admin key with 401", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/adm", headers: { "x-admin-key": "wrong" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    await app.close();
  });

  it("admin route accepts the correct admin key", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/adm", headers: { "x-admin-key": "admin-secret" } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("bearer route rejects a missing token with 401", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/bear" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("bearer route sets request.actor for a valid token", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/bear", headers: { authorization: "Bearer pmk_good" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().actor).toEqual({ actorId: "tok_x", organizationId: "org_1", type: "service" });
    await app.close();
  });

  it("bearer route rejects an unknown token with 401", async () => {
    const app = buildApp(dbWithToken(false));
    const res = await app.inject({ method: "GET", url: "/bear", headers: { authorization: "Bearer pmk_bad" } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("defaults to bearer when no config.auth is declared", async () => {
    const app = buildApp(dbWithToken(true));
    const res = await app.inject({ method: "GET", url: "/def" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugins/authentication.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `authentication.ts`**

Create `src/plugins/authentication.ts`:

```typescript
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/index.js";
import { UnauthorizedError } from "../lib/errors.js";
import { createTokenRepository } from "../modules/auth/repository.js";
import { resolveActor, type Actor } from "../modules/auth/actor.js";

type AuthPolicy = "public" | "admin" | "bearer";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
  interface FastifyContextConfig {
    auth?: AuthPolicy;
  }
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function registerAuthentication(app: FastifyInstance, config: AppConfig): void {
  app.addHook("onRequest", async (req) => {
    const policy: AuthPolicy = req.routeOptions.config.auth ?? "bearer";
    if (policy === "public") return;

    if (policy === "admin") {
      if (header(req, "x-admin-key") !== config.authAdminKey || config.authAdminKey.length === 0) {
        throw new UnauthorizedError("invalid admin credentials");
      }
      return;
    }

    // bearer
    const repo = createTokenRepository(app.db, config.authTokenPepper);
    req.actor = await resolveActor(repo, config.authTokenPepper, header(req, "authorization"));
  });
}
```

> Note the `config.authAdminKey.length === 0` guard: an empty admin key (dev default) never authorizes an admin route. This prevents an unconfigured server from accepting a blank `x-admin-key`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugins/authentication.test.ts`
Expected: PASS.

> If TypeScript complains that `req.routeOptions.config` is possibly undefined, it is populated by Fastify for matched routes; the `FastifyContextConfig` augmentation above makes `.auth` typed. Access is `req.routeOptions.config.auth`.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/authentication.ts test/plugins/authentication.test.ts
git commit -m "feat(pm-004): add authentication plugin with per-route policy"
```

---

### Task 8: Org enforcement in tenant-context

**Files:**
- Modify: `src/plugins/tenant-context.ts`
- Test: `test/plugins/tenant-context.test.ts`

**Interfaces:**
- Consumes: `request.actor` (Task 7); `ForbiddenScopeError` (Task 2); existing `resolveContext`.
- Produces: unchanged public signature `registerTenantContext(app)`. New behavior: when `request.actor` is present, the resolved `organizationId` must equal `request.actor.organizationId`, else throw `ForbiddenScopeError`.

The enforcement compares against the org that tenant-context resolves. Today tenant-context reads `x-organization-id`; the management routes carry the org in the path. To keep one enforcement point, compare `request.actor.organizationId` against the resolved context's `organizationId` when a context was resolved, AND (for actor-bearing requests that did not supply the header) fall back to comparing against the header value directly. Concretely: if an actor is present and an `x-organization-id` header is present, they must match before resolution proceeds.

- [ ] **Step 1: Write the failing test**

Add to `test/plugins/tenant-context.test.ts`. First extend `buildApp` to allow seeding an actor via a pre-hook, then add the cases:

```typescript
// Add near the top-level imports:
import { ForbiddenScopeError } from "../../src/lib/errors.js";

// Add a helper app that injects an actor before tenant-context runs:
function buildAppWithActor(db: Db, actorOrgId: string): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  registerErrorHandler(app);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { actor: unknown }).actor = {
      actorId: "tok_x", organizationId: actorOrgId, type: "service",
    };
  });
  registerTenantContext(app);
  app.get("/probe", async (req) => ({ ctx: req.projectContext ?? null }));
  return app;
}

describe("tenant-context org enforcement", () => {
  it("allows a request whose header org matches the actor org", async () => {
    const app = buildAppWithActor(dbOrgOnly(), orgId);
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects with 403 when the header org differs from the actor org", async () => {
    const other = newOrgId();
    const app = buildAppWithActor(dbOrgOnly(), other);
    const res = await app.inject({ method: "GET", url: "/probe", headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugins/tenant-context.test.ts`
Expected: FAIL — the mismatch case returns 200 (no enforcement yet).

- [ ] **Step 3: Implement enforcement**

Modify `src/plugins/tenant-context.ts`. Add the import and the check inside the `onRequest` hook, after reading the header and before `resolveContext`:

```typescript
import { ForbiddenScopeError } from "../lib/errors.js";
```

Replace the hook body so it reads:

```typescript
  app.addHook("onRequest", async (req) => {
    const organizationId = header(req, "x-organization-id");
    if (organizationId === undefined) return; // no-op; path-scoped routes handle their own ids

    if (req.actor && req.actor.organizationId !== organizationId) {
      throw new ForbiddenScopeError("token not permitted for this organization");
    }

    const repo = createRepository(app.db);
    req.projectContext = await resolveContext(repo, {
      organizationId,
      projectId: header(req, "x-project-id"),
    });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugins/tenant-context.test.ts`
Expected: PASS (including the pre-existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/tenant-context.ts test/plugins/tenant-context.test.ts
git commit -m "feat(pm-004): enforce token org in tenant-context"
```

---

### Task 9: Token management routes

**Files:**
- Create: `src/routes/tokens.ts`
- Test: `test/routes/tokens.test.ts`

**Interfaces:**
- Consumes: `createTokenRepository` (Task 5); `createTokenBodySchema`, `tokenIdSchema` (Task 4); `createRepository` from project-context (for org existence); `orgIdSchema` (project-context entities); `InvalidTenantScopeError`, `TenantNotFoundError` (existing errors).
- Produces: `registerTokenRoutes(app: FastifyInstance, pepper: string): void`. All routes declare `config: { auth: "admin" }`.
  - `POST /organizations/:orgId/tokens` → `201 { id, name, prefix, secret }`.
  - `GET /organizations/:orgId/tokens` → `200 { tokens: PublicToken[] }`.
  - `DELETE /organizations/:orgId/tokens/:tokenId` → `204` on revoke, `404` if nothing revoked.

- [ ] **Step 1: Write the failing test**

Create `test/routes/tokens.test.ts`:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { registerTokenRoutes } from "../../src/routes/tokens.js";
import { registerErrorHandler } from "../../src/plugins/error-handler.js";
import { newOrgId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function buildApp(handlers: Record<string, Record<string, unknown>>): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate("db", { collection: (n: string) => handlers[n] } as unknown as Db);
  registerErrorHandler(app);
  registerTokenRoutes(app, "pepper");
  return app;
}

const orgExists = { findOne: vi.fn().mockResolvedValue({ id: orgId, name: "a", createdAt: "", updatedAt: "" }) };

describe("POST /organizations/:orgId/tokens", () => {
  it("creates a token and returns the plaintext secret once", async () => {
    const app = buildApp({
      organizations: orgExists,
      service_tokens: { insertOne: vi.fn().mockResolvedValue({}) },
    });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: "kiro-ci" } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.secret).toMatch(/^pmk_/);
    expect(body.prefix).toMatch(/^pmk_/);
    expect(body.name).toBe("kiro-ci");
    expect(body.hashedSecret).toBeUndefined();
    await app.close();
  });

  it("returns 404 when the org does not exist", async () => {
    const app = buildApp({
      organizations: { findOne: vi.fn().mockResolvedValue(null) },
      service_tokens: { insertOne: vi.fn() },
    });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for an empty name", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { insertOne: vi.fn() } });
    const res = await app.inject({ method: "POST", url: `/organizations/${orgId}/tokens`, payload: { name: " " } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /organizations/:orgId/tokens", () => {
  it("lists tokens without secrets", async () => {
    const toArray = vi.fn().mockResolvedValue([{ id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x", createdAt: "", revokedAt: null }]);
    const app = buildApp({ organizations: orgExists, service_tokens: { find: vi.fn().mockReturnValue({ toArray }) } });
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}/tokens` });
    expect(res.statusCode).toBe(200);
    expect(res.json().tokens[0].hashedSecret).toBeUndefined();
    await app.close();
  });
});

describe("DELETE /organizations/:orgId/tokens/:tokenId", () => {
  it("returns 204 when a token is revoked", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } });
    const res = await app.inject({ method: "DELETE", url: `/organizations/${orgId}/tokens/tok_01ARZ3NDEKTSV4RRFFQ69G5FAV` });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it("returns 404 when nothing was revoked", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) } });
    const res = await app.inject({ method: "DELETE", url: `/organizations/${orgId}/tokens/tok_01ARZ3NDEKTSV4RRFFQ69G5FAV` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for a malformed token id", async () => {
    const app = buildApp({ organizations: orgExists, service_tokens: { updateOne: vi.fn() } });
    const res = await app.inject({ method: "DELETE", url: `/organizations/${orgId}/tokens/bad` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes/tokens.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `tokens.ts`**

Create `src/routes/tokens.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { createTokenRepository } from "../modules/auth/repository.js";
import { createTokenBodySchema, tokenIdSchema } from "../modules/auth/entities.js";
import { orgIdSchema } from "../modules/project-context/entities.js";
import { createRepository } from "../modules/project-context/repository.js";
import { InvalidTenantScopeError, TenantNotFoundError } from "../lib/errors.js";

const ADMIN = { config: { auth: "admin" as const } };

function parseOrThrow<T>(
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  value: unknown,
  msg: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new InvalidTenantScopeError(msg);
  return r.data as T;
}

export function registerTokenRoutes(app: FastifyInstance, pepper: string): void {
  const tokens = () => createTokenRepository(app.db, pepper);
  const orgs = () => createRepository(app.db);

  async function requireOrg(orgId: string): Promise<void> {
    parseOrThrow(orgIdSchema, orgId, "organization id is malformed");
    if (!(await orgs().getOrganization(orgId))) throw new TenantNotFoundError();
  }

  app.post("/organizations/:orgId/tokens", ADMIN, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    await requireOrg(orgId);
    const { name } = parseOrThrow(createTokenBodySchema, req.body, "name is required");
    const { token, secret } = await tokens().createToken(orgId, name);
    reply.status(201);
    return { id: token.id, name: token.name, prefix: token.prefix, secret };
  });

  app.get("/organizations/:orgId/tokens", ADMIN, async (req) => {
    const { orgId } = req.params as { orgId: string };
    await requireOrg(orgId);
    return { tokens: await tokens().listTokens(orgId) };
  });

  app.delete("/organizations/:orgId/tokens/:tokenId", ADMIN, async (req, reply) => {
    const { orgId, tokenId } = req.params as { orgId: string; tokenId: string };
    await requireOrg(orgId);
    parseOrThrow(tokenIdSchema, tokenId, "token id is malformed");
    const revoked = await tokens().revokeToken(orgId, tokenId);
    if (!revoked) throw new TenantNotFoundError();
    reply.status(204);
    return null;
  });
}
```

> `requireOrg` runs Zod format validation (→ 400) then existence (→ 404), matching the org-route conventions. Revoke of an unknown/already-revoked token maps to the generic 404 `TenantNotFoundError`, consistent with the non-leaking-404 pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/tokens.ts test/routes/tokens.test.ts
git commit -m "feat(pm-004): add admin-gated token management routes"
```

---

### Task 10: Indexes for service_tokens

**Files:**
- Modify: `src/lib/indexes.ts`
- Test: `test/lib/indexes.test.ts`

**Interfaces:**
- Consumes: existing `ROOT_INDEXES` structure and `ensureIndexes(db)`.
- Produces: `service_tokens` added to `ROOT_COLLECTION_INDEXES` with a unique `id` index, a unique `hashedSecret` index, and an `organizationId` lookup index.

- [ ] **Step 1: Write the failing test**

Add to `test/lib/indexes.test.ts` (adapt the import to the file's existing import of `ROOT_INDEXES`; if it is not imported yet, add it):

```typescript
import { ROOT_INDEXES } from "../../src/lib/indexes.js";

describe("service_tokens indexes", () => {
  it("declares unique id, unique hashedSecret, and org lookup", () => {
    const entry = ROOT_INDEXES.find((c) => c.collection === "service_tokens");
    expect(entry).toBeDefined();
    const names = entry!.indexes.map((i) => i.name);
    expect(names).toContain("id_unique");
    expect(names).toContain("hashed_secret_unique");
    expect(names).toContain("org_lookup");
    const hs = entry!.indexes.find((i) => i.name === "hashed_secret_unique");
    expect(hs!.unique).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lib/indexes.test.ts`
Expected: FAIL — no `service_tokens` entry.

- [ ] **Step 3: Add the index specs**

In `src/lib/indexes.ts`, add an entry to the `ROOT_COLLECTION_INDEXES` array:

```typescript
  {
    collection: "service_tokens",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      { key: { hashedSecret: 1 }, name: "hashed_secret_unique", unique: true },
      { key: { organizationId: 1 }, name: "org_lookup" },
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lib/indexes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexes.ts test/lib/indexes.test.ts
git commit -m "feat(pm-004): add service_tokens indexes"
```

---

### Task 11: Wire auth into the app and gate existing routes

**Files:**
- Modify: `src/app.ts`
- Modify: `src/routes/health.ts`
- Modify: `src/routes/organizations.ts`
- Test: `test/app.test.ts`

**Interfaces:**
- Consumes: `registerAuthentication` (Task 7), `registerTokenRoutes` (Task 9), `AppConfig`.
- Produces: `buildApp` registers `authentication` before `tenant-context` and registers token routes. `GET /health` and `/ready` are `public`. `POST /organizations` is `admin`; all other org/project routes are `bearer`.

- [ ] **Step 1: Write the failing test**

Add to `test/app.test.ts` (this file already builds the full app; reuse its existing `buildApp` harness and mongo mock — inspect the top of the file for how it constructs `config` and `db`, then add cases). Add:

```typescript
  it("serves /health without credentials (public)", async () => {
    // uses the file's existing app-building helper
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects GET /organizations without a bearer token (401)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/organizations" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects POST /organizations without the admin key (401)", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "POST", url: "/organizations", payload: { name: "Acme" } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
```

> If `test/app.test.ts` builds the app inline rather than via a helper, mirror that construction. The app's `config` must include `authAdminKey` and `authTokenPepper` (add non-empty values, e.g. `"admin-secret"`/`"pepper"`, to whatever config object the test builds). The mongo mock must return a `collection()` whose `find(...).toArray()` resolves to `[]` and whose `findOne` resolves to `null`, so unauthenticated requests fail at the auth gate before touching data.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/app.test.ts`
Expected: FAIL — routes currently need no credentials, so `GET /organizations` and `POST /organizations` return non-401 statuses.

- [ ] **Step 3: Wire the plugin and token routes in `app.ts`**

Modify `src/app.ts` imports and `buildApp`:

```typescript
import { registerAuthentication } from "./plugins/authentication.js";
import { registerTokenRoutes } from "./routes/tokens.js";
```

Inside `buildApp`, register authentication **before** tenant-context and add token routes (order matters — auth must run first):

```typescript
  app.decorate("db", db);

  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerAuthentication(app, config);
  registerTenantContext(app);
  registerOrganizationRoutes(app);
  registerTokenRoutes(app, config.authTokenPepper);
```

> `onRequest` hooks run in registration order, so registering `authentication` before `tenantContext` guarantees the actor is resolved before org enforcement. Health routes are registered first but declare `public` (next step), so ordering relative to auth is safe either way.

- [ ] **Step 4: Declare route policies**

In `src/routes/health.ts`, mark both routes public:

```typescript
  app.get("/health", { config: { auth: "public" } }, async () => ({ status: "ok" }));

  app.get("/ready", { config: { auth: "public" } }, async (_req, reply: FastifyReply) => {
```

In `src/routes/organizations.ts`, define policy constants at the top of `registerOrganizationRoutes` and attach them. `POST /organizations` is admin; the rest are bearer:

```typescript
  const ADMIN = { config: { auth: "admin" as const } };
  const BEARER = { config: { auth: "bearer" as const } };

  app.post("/organizations", ADMIN, async (req, reply) => { /* unchanged body */ });
  app.get("/organizations", BEARER, async () => ({ organizations: await repo().listOrganizations() }));
  app.get("/organizations/:orgId", BEARER, async (req) => { /* unchanged body */ });
  app.post("/organizations/:orgId/projects", BEARER, async (req, reply) => { /* unchanged body */ });
  app.get("/organizations/:orgId/projects", BEARER, async (req) => { /* unchanged body */ });
  app.get("/organizations/:orgId/projects/:projectId", BEARER, async (req) => { /* unchanged body */ });
```

> Only the options argument is added to each `app.<method>(path, OPTS, handler)` call; the handler bodies are unchanged. Keep each existing handler exactly as-is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/app.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/routes/health.ts src/routes/organizations.ts test/app.test.ts
git commit -m "feat(pm-004): wire authentication plugin and gate routes"
```

---

### Task 12: End-to-end auth + tenancy integration test

**Files:**
- Create: `test/routes/auth-e2e.test.ts`

**Interfaces:**
- Consumes: `buildApp` (`src/app.ts`); `createTokenRepository`/`hashSecret` semantics via the mocked db.
- Produces: a full-chain test proving bearer + matching org reaches a scoped route; bearer + mismatched org → 403; no bearer → 401.

This test builds the real `buildApp` with a mock `Db`. The mock must return, for `service_tokens.findOne({ hashedSecret, revokedAt: null })`, a token bound to `orgId` — regardless of the exact hash value — so a `Bearer` request authenticates as that org. It must return the org from `organizations.findOne`.

- [ ] **Step 1: Write the test**

Create `test/routes/auth-e2e.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { buildApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/index.js";
import { newOrgId } from "../../src/modules/project-context/entities.js";

const orgId = newOrgId();
const config = {
  port: 0, host: "0.0.0.0", nodeEnv: "test", logLevel: "silent",
  mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "admin-secret", authTokenPepper: "pepper",
} as AppConfig;

// A token bound to orgId, active. Any hash lookup returns it.
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
      return { findOne: vi.fn().mockResolvedValue(null) };
    },
  } as unknown as Db;
}

describe("auth end-to-end", () => {
  it("no bearer → 401 on a bearer route", async () => {
    const app = buildApp({ config, db: mockDb() });
    const res = await app.inject({ method: "GET", url: `/organizations/${orgId}`, headers: { "x-organization-id": orgId } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("bearer + matching org → 200", async () => {
    const app = buildApp({ config, db: mockDb() });
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${orgId}`,
      headers: { authorization: "Bearer pmk_any", "x-organization-id": orgId },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("bearer + mismatched org header → 403", async () => {
    const other = newOrgId();
    const app = buildApp({ config, db: mockDb() });
    const res = await app.inject({
      method: "GET",
      url: `/organizations/${orgId}`,
      headers: { authorization: "Bearer pmk_any", "x-organization-id": other },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_SCOPE");
    await app.close();
  });
});
```

> `GET /organizations/:orgId` is a bearer route that reads the org from the path but does not require the `x-organization-id` header. This test supplies the header so tenant-context runs org enforcement, exercising the 403 path. The 200 case confirms a matching header passes through.

- [ ] **Step 2: Run test to verify behavior**

Run: `npx vitest run test/routes/auth-e2e.test.ts`
Expected: PASS. (No implementation change — this is an integration test over Tasks 7–11.)

- [ ] **Step 3: Full verification**

Run: `npm run check`
Expected: lint + typecheck + all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add test/routes/auth-e2e.test.ts
git commit -m "test(pm-004): end-to-end auth and org enforcement"
```

---

## Self-Review

**Spec coverage:**

- Service tokens (`pmk_`, hash-only, one org) → Tasks 3, 4, 5. ✓
- Authentication plugin before tenant-context → Tasks 7, 11. ✓
- Org enforcement (403) → Task 8. ✓
- Token management routes (create/list/revoke, admin-gated, soft-revoke) → Task 9. ✓
- Admin key gates `POST /organizations` and token routes → Tasks 9, 11. ✓
- Minimal actor `{ actorId, organizationId, type }` → Task 6. ✓
- Per-route `config.auth` with default `bearer` → Task 7. ✓
- Fast HMAC-SHA-256 + pepper, no new dependency → Task 3. ✓
- Config admin key + pepper, prod-required → Task 1. ✓
- `service_tokens` indexes (unique id, unique hash, org lookup) → Task 10. ✓
- Error classes 401/403 with nested `{ error: { code, message } }` → Task 2 + reuse of existing handler. ✓
- Isolation/security guarantees (generic 401, immediate revoke, secret-once, admin≠bearer) → Tasks 5, 6, 7, 9, 12. ✓
- End-to-end proof → Task 12. ✓

Out-of-scope items (outbound identity, RBAC, OIDC, actor entity, expiry, pagination) are intentionally absent — no tasks, correct.

**Placeholder scan:** No TBD/TODO. Every code step has concrete code. The one deliberately-unshown region is the *unchanged* org-route handler bodies in Task 11 (explicitly marked "unchanged body" / "keep as-is"), which is a modification instruction, not a placeholder.

**Type consistency:**

- `createTokenRepository(db, pepper)` and its methods used identically in Tasks 5, 7, 9.
- `resolveActor(repo, pepper, header)` signature identical in Tasks 6, 7.
- `Actor` shape `{ actorId, organizationId, type: "service" }` identical in Tasks 6, 7, 8, 12.
- `config.auth` values `"public" | "admin" | "bearer"` identical in Tasks 7, 9, 11.
- Error codes `UNAUTHORIZED` / `FORBIDDEN_SCOPE` identical in Tasks 2, 7, 8, 11, 12.
- `hashSecret(secret, pepper)` / `generateSecret()` identical in Tasks 3, 5.
- `service_tokens` collection name and index names identical in Tasks 5, 10.
