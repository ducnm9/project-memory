# Git Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a `git-connector` module that clones/fetches Git repos, exposes file tree and commit log, and stores per-repo credentials encrypted at rest in MongoDB.

**Architecture:** Single `src/modules/git-connector/` module following the factory-function pattern used throughout this codebase. `CredentialStore` encrypts PAT/deploy-key values with AES-256-GCM using `node:crypto`. `GitConnector` uses `simple-git` to clone/fetch and expose file tree and commit log. No HTTP routes — internal module only.

**Tech Stack:** TypeScript 5.6, Node.js ≥ 20.19, `simple-git` 3.36.0, `node:crypto` (built-in), MongoDB 7.6, Vitest 2.1

**Spec:** `docs/superpowers/specs/2026-09-23-git-connector-design.md`

## Global Constraints

- ESM project (`"type": "module"` in package.json) — all imports must include `.js` extension
- ULID IDs: `cred_<ULID>` prefix (same pattern as `repo_<ULID>`, `know_<ULID>`)
- All dates: ISO 8601 strings via `new Date().toISOString()`
- `projection: { _id: 0 }` on all MongoDB reads
- Test runner: `npm test` (runs `vitest run`); typecheck: `npm run typecheck`
- New error classes go in `src/lib/errors.ts`, extend `AppError`
- No `console.log` — credentials must never be logged
- `simple-git` version: `3.36.0` (exact pin)

---

### Task 1: Install dependency, extend config, add error classes

**Files:**
- Modify: `package.json` (add `simple-git`)
- Modify: `src/config/index.ts`
- Modify: `.env.example`
- Modify: `src/lib/errors.ts`

**Interfaces:**
- Produces: `AppConfig.credentialEncryptionKey: string`, `CredentialNotFoundError`, `GitCloneError`, `FileNotFoundError`

- [ ] **Step 1: Install simple-git**

```bash
npm install simple-git@3.36.0
```

Expected: `simple-git` appears in `package.json` `dependencies`.

- [ ] **Step 2: Add `CREDENTIAL_ENCRYPTION_KEY` to `.env.example`**

Open `.env.example` and append:

```
# AES-256-GCM key for encrypting connector credentials at rest (required in production).
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CREDENTIAL_ENCRYPTION_KEY=
```

- [ ] **Step 3: Extend `src/config/index.ts`**

Add `credentialEncryptionKey: string` to `AppConfig`, add the Zod field, and add the production check.

Replace the `AppConfig` interface with:

```ts
export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: "development" | "production" | "test";
  logLevel: string;
  mongodbUri: string;
  mongodbDbName: string;
  authAdminKey: string;
  authTokenPepper: string;
  credentialEncryptionKey: string;
}
```

In the Zod `schema`, after `AUTH_TOKEN_PEPPER`, add:

```ts
  CREDENTIAL_ENCRYPTION_KEY: z.string().default(""),
```

In the production check block, after the `AUTH_TOKEN_PEPPER` check, add:

```ts
    if (data.CREDENTIAL_ENCRYPTION_KEY.length < 64) missing.push("CREDENTIAL_ENCRYPTION_KEY");
```

In the `Object.freeze({...})` return, after `authTokenPepper`, add:

```ts
    credentialEncryptionKey: data.CREDENTIAL_ENCRYPTION_KEY,
```

- [ ] **Step 4: Add three new error classes to `src/lib/errors.ts`**

Append to the end of the file:

```ts
export class CredentialNotFoundError extends AppError {
  constructor(message = "connector credential not found") {
    super(message, 404, "CREDENTIAL_NOT_FOUND");
  }
}

export class GitCloneError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, "GIT_CLONE_FAILED");
    if (cause !== undefined) this.cause = cause;
  }
}

export class FileNotFoundError extends AppError {
  constructor(message = "file not found in repository") {
    super(message, 404, "FILE_NOT_FOUND");
  }
}
```

- [ ] **Step 5: Run typecheck and tests to verify no regressions**

```bash
npm run typecheck && npm test
```

Expected: all existing tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config/index.ts .env.example src/lib/errors.ts
git commit -m "feat(git-connector): install simple-git, add config key, add error classes"
```

---

### Task 2: Entities

**Files:**
- Create: `src/modules/git-connector/entities.ts`
- Create: `test/modules/git-connector/entities.test.ts`

**Interfaces:**
- Produces: `CredentialType`, `RepositoryCredential`, `GitCommit`, `GitFileEntry`, `GitConnectorConfig`, `newCredentialId()`

- [ ] **Step 1: Write the failing test**

Create `test/modules/git-connector/entities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newCredentialId } from "../../../src/modules/git-connector/entities.js";

describe("newCredentialId", () => {
  it("returns a string prefixed with 'cred_'", () => {
    expect(newCredentialId()).toMatch(/^cred_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("generates unique ids", () => {
    expect(newCredentialId()).not.toBe(newCredentialId());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --reporter=verbose test/modules/git-connector/entities.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/modules/git-connector/entities.ts`**

```ts
import { ulid } from "ulid";

export type CredentialType = "none" | "token" | "deploy_key";

export interface RepositoryCredential {
  id: string;              // "cred_<ULID>"
  repositoryId: string;
  type: CredentialType;
  encryptedValue: string | null; // AES-256-GCM ciphertext, base64url; null for type "none"
  iv: string;                    // GCM nonce, base64url (12 bytes)
  authTag: string;               // GCM auth tag, base64url (16 bytes)
  createdAt: string;
  updatedAt: string;
}

export interface GitCommit {
  hash: string;
  author: { name: string; email: string };
  timestamp: string;   // ISO 8601
  message: string;
  changedFiles: string[];
}

export interface GitFileEntry {
  path: string;
  size: number;          // bytes
  type: "file" | "directory";
}

export interface GitConnectorConfig {
  workDir: string;
  maxFileSizeBytes: number;    // default: 1_048_576 (1 MB)
  defaultCommitLimit: number;  // default: 100
}

export function newCredentialId(): string {
  return `cred_${ulid()}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose test/modules/git-connector/entities.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/git-connector/entities.ts test/modules/git-connector/entities.test.ts
git commit -m "feat(git-connector): add entities"
```

---

### Task 3: CredentialStore

**Files:**
- Create: `src/modules/git-connector/credential-store.ts`
- Create: `test/modules/git-connector/credential-store.test.ts`

**Interfaces:**
- Consumes: `RepositoryCredential`, `CredentialType`, `newCredentialId()` from `./entities.js`
- Produces:
  - `interface CredentialStore { upsertCredential(repositoryId, type, plaintext): Promise<RepositoryCredential>; getCredential(repositoryId): Promise<RepositoryCredential | null>; deleteCredential(repositoryId): Promise<void>; }`
  - `createCredentialStore(db: Db, encryptionKey: Buffer): CredentialStore`
  - `decryptCredential(credential: RepositoryCredential, key: Buffer): string`

- [ ] **Step 1: Write the failing tests**

Create `test/modules/git-connector/credential-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  createCredentialStore,
  decryptCredential,
} from "../../../src/modules/git-connector/credential-store.js";
import type { RepositoryCredential } from "../../../src/modules/git-connector/entities.js";

const TEST_KEY = Buffer.alloc(32, 0x42); // 32 bytes of 0x42 for deterministic tests

function mockCol(overrides: Record<string, unknown> = {}) {
  const replaceOne = vi.fn().mockResolvedValue({ upsertedCount: 1 });
  const findOne = vi.fn().mockResolvedValue(null);
  const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
  const col = { replaceOne, findOne, deleteOne, ...overrides };
  const db = {
    collection: vi.fn(() => col),
  } as unknown as Db;
  return { db, col };
}

describe("upsertCredential", () => {
  it("stores an encrypted value — plaintext never appears in replaceOne call", async () => {
    const { db, col } = mockCol();
    const store = createCredentialStore(db, TEST_KEY);
    const plaintext = "ghp_supersecret";
    await store.upsertCredential("repo_1", "token", plaintext);

    expect(col.replaceOne).toHaveBeenCalledOnce();
    const [filter, doc, opts] = col.replaceOne.mock.calls[0];
    expect(filter).toEqual({ repositoryId: "repo_1" });
    expect(opts).toEqual({ upsert: true });
    expect(doc.encryptedValue).not.toBe(plaintext);
    expect(JSON.stringify(doc)).not.toContain(plaintext);
  });

  it("returns a credential with id prefixed 'cred_'", async () => {
    const { db } = mockCol();
    const store = createCredentialStore(db, TEST_KEY);
    const result = await store.upsertCredential("repo_1", "token", "ghp_supersecret");
    expect(result.id).toMatch(/^cred_/);
    expect(result.repositoryId).toBe("repo_1");
    expect(result.type).toBe("token");
  });

  it("stores null encryptedValue for type 'none'", async () => {
    const { db, col } = mockCol();
    const store = createCredentialStore(db, TEST_KEY);
    await store.upsertCredential("repo_1", "none", null);
    const [, doc] = col.replaceOne.mock.calls[0];
    expect(doc.encryptedValue).toBeNull();
  });
});

describe("decryptCredential", () => {
  it("round-trips: decrypt(upsert result) === original plaintext", async () => {
    const { db } = mockCol();
    const store = createCredentialStore(db, TEST_KEY);
    const plaintext = "ghp_roundtriptest";
    const credential = await store.upsertCredential("repo_1", "token", plaintext);
    expect(decryptCredential(credential, TEST_KEY)).toBe(plaintext);
  });

  it("returns empty string for type 'none' (null encryptedValue)", async () => {
    const credential: RepositoryCredential = {
      id: "cred_1",
      repositoryId: "repo_1",
      type: "none",
      encryptedValue: null,
      iv: "",
      authTag: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(decryptCredential(credential, TEST_KEY)).toBe("");
  });
});

describe("getCredential", () => {
  it("returns null when no credential exists", async () => {
    const { db } = mockCol();
    const result = await createCredentialStore(db, TEST_KEY).getCredential("repo_1");
    expect(result).toBeNull();
  });

  it("queries by repositoryId with _id projection suppressed", async () => {
    const { db, col } = mockCol();
    await createCredentialStore(db, TEST_KEY).getCredential("repo_1");
    expect(col.findOne).toHaveBeenCalledWith(
      { repositoryId: "repo_1" },
      { projection: { _id: 0 } },
    );
  });
});

describe("deleteCredential", () => {
  it("calls deleteOne with the repositoryId filter", async () => {
    const { db, col } = mockCol();
    await createCredentialStore(db, TEST_KEY).deleteCredential("repo_1");
    expect(col.deleteOne).toHaveBeenCalledWith({ repositoryId: "repo_1" });
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test -- --reporter=verbose test/modules/git-connector/credential-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/modules/git-connector/credential-store.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Db } from "mongodb";
import {
  newCredentialId,
  type CredentialType,
  type RepositoryCredential,
} from "./entities.js";

const READ_OPTS = { projection: { _id: 0 } } as const;

function encrypt(
  plaintext: string,
  key: Buffer,
): { encryptedValue: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encryptedValue: encrypted.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptCredential(credential: RepositoryCredential, key: Buffer): string {
  if (!credential.encryptedValue) return "";
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(credential.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(credential.authTag, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(credential.encryptedValue, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export interface CredentialStore {
  upsertCredential(
    repositoryId: string,
    type: CredentialType,
    plaintext: string | null,
  ): Promise<RepositoryCredential>;
  getCredential(repositoryId: string): Promise<RepositoryCredential | null>;
  deleteCredential(repositoryId: string): Promise<void>;
}

export function createCredentialStore(db: Db, encryptionKey: Buffer): CredentialStore {
  const col = () => db.collection<RepositoryCredential>("connector_credentials");

  return {
    async upsertCredential(repositoryId, type, plaintext) {
      const now = new Date().toISOString();
      const encFields =
        plaintext === null || type === "none"
          ? { encryptedValue: null, iv: "", authTag: "" }
          : encrypt(plaintext, encryptionKey);

      const credential: RepositoryCredential = {
        id: newCredentialId(),
        repositoryId,
        type,
        ...encFields,
        createdAt: now,
        updatedAt: now,
      };
      await col().replaceOne({ repositoryId }, credential, { upsert: true });
      return credential;
    },

    async getCredential(repositoryId) {
      return col().findOne(
        { repositoryId },
        READ_OPTS,
      ) as Promise<RepositoryCredential | null>;
    },

    async deleteCredential(repositoryId) {
      await col().deleteOne({ repositoryId });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose test/modules/git-connector/credential-store.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/git-connector/credential-store.ts test/modules/git-connector/credential-store.test.ts
git commit -m "feat(git-connector): add CredentialStore with AES-256-GCM encryption"
```

---

### Task 4: GitConnector

**Files:**
- Create: `src/modules/git-connector/git-connector.ts`
- Create: `test/modules/git-connector/git-connector.test.ts`

**Interfaces:**
- Consumes:
  - `CredentialStore`, `decryptCredential` from `./credential-store.js`
  - `GitConnectorConfig`, `GitCommit`, `GitFileEntry` from `./entities.js`
  - `GitCloneError`, `FileNotFoundError` from `../../lib/errors.js`
- Produces:
  - `interface GitConnector { connect(repositoryId, cloneUrl): Promise<string>; listFiles(repositoryId, subPath?): Promise<GitFileEntry[]>; readFile(repositoryId, filePath): Promise<string | null>; readCommits(repositoryId, limit?): Promise<GitCommit[]>; disconnect(repositoryId): Promise<void>; }`
  - `createGitConnector(credentialStore, encryptionKey, config): GitConnector`

- [ ] **Step 1: Write the failing tests**

Create `test/modules/git-connector/git-connector.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryCredential } from "../../../src/modules/git-connector/entities.js";

// --- mock simple-git ---
const mockGitInstance = {
  clone: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn().mockResolvedValue(undefined),
  raw: vi.fn().mockResolvedValue(""),
  env: vi.fn(),
};
mockGitInstance.env.mockReturnValue(mockGitInstance);

vi.mock("simple-git", () => ({
  default: vi.fn(() => mockGitInstance),
}));

// --- mock node:fs/promises ---
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockRm = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockStat = vi.fn();
const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  mkdir: mockMkdir,
  rm: mockRm,
  writeFile: mockWriteFile,
  stat: mockStat,
  readFile: mockReadFile,
}));

// --- mock node:fs ---
const mockExistsSync = vi.fn();
vi.mock("node:fs", () => ({ existsSync: mockExistsSync }));

// import AFTER mocks
const { createGitConnector } = await import(
  "../../../src/modules/git-connector/git-connector.js"
);
const { GitCloneError, FileNotFoundError } = await import(
  "../../../src/lib/errors.js"
);

const TEST_KEY = Buffer.alloc(32, 0x00);

const noCredStore = {
  upsertCredential: vi.fn(),
  getCredential: vi.fn().mockResolvedValue(null),
  deleteCredential: vi.fn(),
};

const config = {
  workDir: "/tmp/pm-git",
  maxFileSizeBytes: 1_048_576,
  defaultCommitLimit: 100,
};

function makeConnector(credStore = noCredStore) {
  return createGitConnector(credStore, TEST_KEY, config);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGitInstance.env.mockReturnValue(mockGitInstance);
  mockGitInstance.clone.mockResolvedValue(undefined);
  mockGitInstance.fetch.mockResolvedValue(undefined);
  mockGitInstance.raw.mockResolvedValue("");
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- connect() ----

describe("connect() — no credentials", () => {
  it("clones when the local .git directory does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    const result = await connector.connect("repo_1", "https://github.com/org/repo");
    expect(mockGitInstance.clone).toHaveBeenCalledWith(
      "https://github.com/org/repo",
      "/tmp/pm-git/repo_1",
    );
    expect(result).toBe("/tmp/pm-git/repo_1");
  });

  it("fetches (not clones) when the local .git directory exists", async () => {
    mockExistsSync.mockReturnValue(true);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");
    expect(mockGitInstance.clone).not.toHaveBeenCalled();
    expect(mockGitInstance.fetch).toHaveBeenCalledWith("origin");
  });

  it("throws GitCloneError when clone fails", async () => {
    mockExistsSync.mockReturnValue(false);
    const gitErr = new Error("auth failed");
    mockGitInstance.clone.mockRejectedValueOnce(gitErr);
    const connector = makeConnector();
    await expect(
      connector.connect("repo_1", "https://github.com/org/repo"),
    ).rejects.toThrow(GitCloneError);
  });
});

describe("connect() — token auth", () => {
  it("embeds token in clone URL", async () => {
    mockExistsSync.mockReturnValue(false);
    // Build an encrypted credential inline via the real CredentialStore to avoid coupling
    // to internal encrypt() — just use a plaintext token in the credential (mocked getCredential)
    const { createCredentialStore } = await import(
      "../../../src/modules/git-connector/credential-store.js"
    );
    const fakeDb = {
      collection: vi.fn(() => ({
        replaceOne: vi.fn().mockResolvedValue({}),
        findOne: vi.fn().mockResolvedValue(null),
        deleteOne: vi.fn().mockResolvedValue({}),
      })),
    } as any;
    const realStore = createCredentialStore(fakeDb, TEST_KEY);
    const credential = await realStore.upsertCredential("repo_1", "token", "ghp_mytoken");

    const tokenCredStore = {
      ...noCredStore,
      getCredential: vi.fn().mockResolvedValue(credential),
    };
    const connector = makeConnector(tokenCredStore);
    await connector.connect("repo_1", "https://github.com/org/repo");

    const cloneUrl: string = mockGitInstance.clone.mock.calls[0][0];
    expect(cloneUrl).toContain("ghp_mytoken");
    expect(cloneUrl).toContain("x-access-token");
  });
});

describe("connect() — deploy key auth", () => {
  it("writes key file, sets GIT_SSH_COMMAND, then deletes the key file", async () => {
    mockExistsSync.mockReturnValue(false);
    const { createCredentialStore } = await import(
      "../../../src/modules/git-connector/credential-store.js"
    );
    const fakeDb = {
      collection: vi.fn(() => ({
        replaceOne: vi.fn().mockResolvedValue({}),
        findOne: vi.fn().mockResolvedValue(null),
        deleteOne: vi.fn().mockResolvedValue({}),
      })),
    } as any;
    const realStore = createCredentialStore(fakeDb, TEST_KEY);
    const credential = await realStore.upsertCredential(
      "repo_1",
      "deploy_key",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----",
    );

    const keyCredStore = {
      ...noCredStore,
      getCredential: vi.fn().mockResolvedValue(credential),
    };
    const connector = makeConnector(keyCredStore);
    await connector.connect("repo_1", "git@github.com:org/repo.git");

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/pm-git/.ssh/repo_1",
      expect.any(String),
      { mode: 0o600 },
    );
    expect(mockGitInstance.env).toHaveBeenCalledWith(
      "GIT_SSH_COMMAND",
      expect.stringContaining("/tmp/pm-git/.ssh/repo_1"),
    );
    expect(mockRm).toHaveBeenCalledWith("/tmp/pm-git/.ssh/repo_1", { force: true });
  });

  it("deletes key file even when clone throws", async () => {
    mockExistsSync.mockReturnValue(false);
    mockGitInstance.clone.mockRejectedValueOnce(new Error("ssh error"));
    const { createCredentialStore } = await import(
      "../../../src/modules/git-connector/credential-store.js"
    );
    const fakeDb = {
      collection: vi.fn(() => ({
        replaceOne: vi.fn().mockResolvedValue({}),
        findOne: vi.fn().mockResolvedValue(null),
        deleteOne: vi.fn().mockResolvedValue({}),
      })),
    } as any;
    const realStore = createCredentialStore(fakeDb, TEST_KEY);
    const credential = await realStore.upsertCredential("repo_1", "deploy_key", "key");
    const keyCredStore = {
      ...noCredStore,
      getCredential: vi.fn().mockResolvedValue(credential),
    };
    const connector = makeConnector(keyCredStore);

    await expect(
      connector.connect("repo_1", "git@github.com:org/repo.git"),
    ).rejects.toThrow(GitCloneError);
    expect(mockRm).toHaveBeenCalledWith("/tmp/pm-git/.ssh/repo_1", { force: true });
  });
});

// ---- listFiles() ----

describe("listFiles()", () => {
  it("parses ls-tree output into GitFileEntry[]", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");

    const lsOutput =
      "100644 blob abc123    1234\tsrc/app.ts\n100644 blob def456    567\tsrc/lib/util.ts\n";
    mockGitInstance.raw.mockResolvedValueOnce(lsOutput);

    const files = await connector.listFiles("repo_1");
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ path: "src/app.ts", size: 1234, type: "file" });
    expect(files[1]).toEqual({ path: "src/lib/util.ts", size: 567, type: "file" });
  });

  it("passes subPath to ls-tree", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");
    mockGitInstance.raw.mockResolvedValueOnce("");

    await connector.listFiles("repo_1", "src/");
    expect(mockGitInstance.raw).toHaveBeenCalledWith([
      "ls-tree", "-r", "-l", "HEAD", "--", "src/",
    ]);
  });

  it("returns empty array for empty output", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");
    mockGitInstance.raw.mockResolvedValueOnce("");

    const files = await connector.listFiles("repo_1");
    expect(files).toEqual([]);
  });
});

// ---- readFile() ----

describe("readFile()", () => {
  it("returns file content when under the size limit", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");

    mockStat.mockResolvedValueOnce({ size: 100 });
    mockReadFile.mockResolvedValueOnce("export const x = 1;\n");

    const result = await connector.readFile("repo_1", "src/app.ts");
    expect(result).toBe("export const x = 1;\n");
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/pm-git/repo_1/src/app.ts", "utf8");
  });

  it("returns null when file exceeds maxFileSizeBytes", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");

    mockStat.mockResolvedValueOnce({ size: 2_000_000 }); // over 1 MB default
    const result = await connector.readFile("repo_1", "large.bin");
    expect(result).toBeNull();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("throws FileNotFoundError when stat rejects with ENOENT", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");

    const err = Object.assign(new Error("not found"), { code: "ENOENT" });
    mockStat.mockRejectedValueOnce(err);

    await expect(connector.readFile("repo_1", "missing.ts")).rejects.toThrow(
      FileNotFoundError,
    );
  });
});

// ---- readCommits() ----

describe("readCommits()", () => {
  it("parses git log output into GitCommit[]", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");

    // Simulate git log --format=%x00COMMIT%x00%H%x01%an%x01%ae%x01%aI%x01%s --name-only
    const logOutput =
      "\x00COMMIT\x00abc123\x01Alice\x01alice@example.com\x012026-09-23T10:00:00Z\x01fix: bug\nsrc/app.ts\n" +
      "\x00COMMIT\x00def456\x01Bob\x01bob@example.com\x012026-09-22T09:00:00Z\x01feat: thing\nsrc/lib.ts\nsrc/types.ts\n";
    mockGitInstance.raw.mockResolvedValueOnce(logOutput);

    const commits = await connector.readCommits("repo_1");
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: "abc123",
      author: { name: "Alice", email: "alice@example.com" },
      timestamp: "2026-09-23T10:00:00Z",
      message: "fix: bug",
      changedFiles: ["src/app.ts"],
    });
    expect(commits[1].changedFiles).toEqual(["src/lib.ts", "src/types.ts"]);
  });

  it("passes --max-count with the given limit", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");
    mockGitInstance.raw.mockResolvedValueOnce("");

    await connector.readCommits("repo_1", 50);
    const args: string[] = mockGitInstance.raw.mock.calls[0][0];
    expect(args).toContain("--max-count=50");
  });
});

// ---- disconnect() ----

describe("disconnect()", () => {
  it("removes the working directory", async () => {
    mockExistsSync.mockReturnValue(false);
    const connector = makeConnector();
    await connector.connect("repo_1", "https://github.com/org/repo");
    await connector.disconnect("repo_1");
    expect(mockRm).toHaveBeenCalledWith(
      "/tmp/pm-git/repo_1",
      { recursive: true, force: true },
    );
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npm test -- --reporter=verbose test/modules/git-connector/git-connector.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/modules/git-connector/git-connector.ts`**

```ts
import simpleGit from "simple-git";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileNotFoundError, GitCloneError } from "../../lib/errors.js";
import { decryptCredential, type CredentialStore } from "./credential-store.js";
import type { GitCommit, GitConnectorConfig, GitFileEntry } from "./entities.js";

export interface GitConnector {
  connect(repositoryId: string, cloneUrl: string): Promise<string>;
  listFiles(repositoryId: string, subPath?: string): Promise<GitFileEntry[]>;
  readFile(repositoryId: string, filePath: string): Promise<string | null>;
  readCommits(repositoryId: string, limit?: number): Promise<GitCommit[]>;
  disconnect(repositoryId: string): Promise<void>;
}

export function createGitConnector(
  credentialStore: CredentialStore,
  encryptionKey: Buffer,
  config: GitConnectorConfig,
): GitConnector {
  const workDirs = new Map<string, string>();

  function getLocalPath(repositoryId: string): string {
    const p = workDirs.get(repositoryId);
    if (!p) throw new GitCloneError(`repository ${repositoryId} not connected — call connect() first`);
    return p;
  }

  return {
    async connect(repositoryId, cloneUrl) {
      const localPath = join(config.workDir, repositoryId);
      const credential = await credentialStore.getCredential(repositoryId);

      let gitUrl = cloneUrl;
      let sshKeyPath: string | null = null;

      if (credential?.type === "token") {
        const plaintext = decryptCredential(credential, encryptionKey);
        const u = new URL(cloneUrl);
        u.username = "x-access-token";
        u.password = plaintext;
        gitUrl = u.toString();
      } else if (credential?.type === "deploy_key") {
        sshKeyPath = join(config.workDir, ".ssh", repositoryId);
        await mkdir(join(config.workDir, ".ssh"), { recursive: true });
        const plaintext = decryptCredential(credential, encryptionKey);
        await writeFile(sshKeyPath, plaintext, { mode: 0o600 });
      }

      const git = simpleGit({ baseDir: config.workDir });
      if (sshKeyPath) {
        git.env(
          "GIT_SSH_COMMAND",
          `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`,
        );
      }

      try {
        if (existsSync(join(localPath, ".git"))) {
          await simpleGit(localPath).fetch("origin");
        } else {
          await mkdir(localPath, { recursive: true });
          await git.clone(gitUrl, localPath);
        }
      } catch (err) {
        throw new GitCloneError(`failed to connect to repository ${repositoryId}`, err);
      } finally {
        if (sshKeyPath) {
          await rm(sshKeyPath, { force: true });
        }
      }

      workDirs.set(repositoryId, localPath);
      return localPath;
    },

    async listFiles(repositoryId, subPath) {
      const localPath = getLocalPath(repositoryId);
      const args = ["ls-tree", "-r", "-l", "HEAD"];
      if (subPath) args.push("--", subPath);
      const output: string = await simpleGit(localPath).raw(args);
      if (!output.trim()) return [];

      // ponytail: only blobs returned by -r; directories not emitted in recursive mode.
      //   Add without -r + manual recursion if callers need explicit dir entries.
      return output
        .split("\n")
        .filter(Boolean)
        .map((line): GitFileEntry => {
          const tabIdx = line.indexOf("\t");
          const meta = line.slice(0, tabIdx).trim().split(/\s+/);
          const path = line.slice(tabIdx + 1);
          const sizeStr = meta[3];
          return {
            path,
            size: sizeStr === "-" ? 0 : parseInt(sizeStr, 10),
            type: "file",
          };
        });
    },

    async readFile(repositoryId, filePath) {
      const localPath = getLocalPath(repositoryId);
      const fullPath = join(localPath, filePath);
      let fileSize: number;
      try {
        const s = await stat(fullPath);
        fileSize = s.size;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new FileNotFoundError(`${filePath} not found in repository ${repositoryId}`);
        }
        throw err;
      }
      if (fileSize > config.maxFileSizeBytes) return null;
      return readFile(fullPath, "utf8");
    },

    async readCommits(repositoryId, limit) {
      const localPath = getLocalPath(repositoryId);
      const n = limit ?? config.defaultCommitLimit;
      const output: string = await simpleGit(localPath).raw([
        "log",
        `--max-count=${n}`,
        "--format=%x00COMMIT%x00%H%x01%an%x01%ae%x01%aI%x01%s",
        "--name-only",
      ]);

      return output
        .split("\x00COMMIT\x00")
        .filter(Boolean)
        .map((block): GitCommit => {
          const lines = block.split("\n").filter(Boolean);
          const [header, ...fileLines] = lines;
          const [hash, authorName, authorEmail, timestamp, message] = header.split("\x01");
          return {
            hash,
            author: { name: authorName, email: authorEmail },
            timestamp,
            message,
            changedFiles: fileLines,
          };
        });
    },

    async disconnect(repositoryId) {
      const localPath = join(config.workDir, repositoryId);
      await rm(localPath, { recursive: true, force: true });
      workDirs.delete(repositoryId);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose test/modules/git-connector/git-connector.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/git-connector/git-connector.ts test/modules/git-connector/git-connector.test.ts
git commit -m "feat(git-connector): add GitConnector with clone/fetch, listFiles, readFile, readCommits"
```

---

### Task 5: Barrel export and final wiring

**Files:**
- Create: `src/modules/git-connector/index.ts`

**Interfaces:**
- Produces: clean public surface for all downstream consumers of the module

- [ ] **Step 1: Create `src/modules/git-connector/index.ts`**

```ts
export type { CredentialStore } from "./credential-store.js";
export { createCredentialStore, decryptCredential } from "./credential-store.js";
export type {
  CredentialType,
  GitCommit,
  GitConnectorConfig,
  GitFileEntry,
  RepositoryCredential,
} from "./entities.js";
export { newCredentialId } from "./entities.js";
export type { GitConnector } from "./git-connector.js";
export { createGitConnector } from "./git-connector.js";
```

- [ ] **Step 2: Run full typecheck and test suite**

```bash
npm run typecheck && npm test
```

Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/modules/git-connector/index.ts
git commit -m "feat(git-connector): add barrel export"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| `GitConnector` service: HTTPS + SSH, handle auth (token/deploy key) | Task 4 |
| Clone to ephemeral working directory | Task 4 |
| File tree traversal API (list files, read file by path) | Task 4 |
| Git log: commits with hash, author, timestamp, message, changed files | Task 4 |
| Most recent N commits on default branch | Task 4 |
| Large repos: stream content, respect file size limits | Task 4 (`readFile` returns null over limit) |
| Credentials stored in secrets system, never as KnowledgeItem | Task 3 |
| Support reconnect / credential refresh | Task 4 (`connect()` idempotent: fetch if dir exists) |
| `CredentialNotFoundError`, `GitCloneError`, `FileNotFoundError` | Task 1 |
| `CREDENTIAL_ENCRYPTION_KEY` config | Task 1 |
| All entities (`RepositoryCredential`, `GitCommit`, `GitFileEntry`, `GitConnectorConfig`) | Task 2 |
| Barrel export | Task 5 |

No spec gaps found.

**Type consistency check:** All types defined in Task 2 (`entities.ts`) are referenced by exact name in Tasks 3–5. No mismatches found.

**Placeholder scan:** No TBD, TODO, or "implement later" found.
