# Git Connector — Design Spec

**Issue:** PM-020  
**Date:** 2026-09-23  
**Status:** Approved

---

## Overview

Implement a `git-connector` module that clones or fetches a Git repository, exposes its file tree and Git log for analysis, and stores per-repository credentials encrypted at rest in MongoDB. The connector is an internal TypeScript service module — not HTTP-exposed in this issue — following the existing factory-function pattern in this codebase.

---

## Module structure

```
src/modules/git-connector/
  entities.ts          # RepositoryCredential, GitCommit, GitFileEntry, GitConnectorConfig
  credential-store.ts  # CredentialStore interface + createCredentialStore()
  git-connector.ts     # GitConnector interface + createGitConnector()
  index.ts             # barrel re-exports

test/modules/git-connector/
  credential-store.test.ts
  git-connector.test.ts
```

No new top-level directories. All files follow the same module layout used by `repository-binding/` and `knowledge-core/`.

---

## New dependency

`simple-git` — thin wrapper around the host's `git` binary. Requires `git` on the host (standard in dev and CI). Supports SSH via the system ssh-agent and per-clone `GIT_SSH_COMMAND` injection.

```
npm install simple-git
```

---

## New environment variable

`CREDENTIAL_ENCRYPTION_KEY` — 32-byte hex string (64 hex chars). Used as the AES-256-GCM key for encrypting credential values at rest.

- Required in production (Zod `.min(64)` on the config schema)
- Defaults to a fixed all-zeros test key in dev/test (same pattern as `AUTH_TOKEN_PEPPER`)
- Never logged; never returned via any API

Add to `src/config/index.ts` and `.env.example`.

---

## Entities (`entities.ts`)

### RepositoryCredential

Stored in the `connector_credentials` MongoDB collection. One document per repository.

```ts
type CredentialType = "none" | "token" | "deploy_key";

interface RepositoryCredential {
  id: string;              // "cred_<ULID>"
  repositoryId: string;    // foreign key → repositories collection
  type: CredentialType;
  encryptedValue: string | null;  // AES-256-GCM ciphertext, base64url; null for type "none"
  iv: string;                     // GCM nonce, base64url (12 bytes)
  authTag: string;                // GCM authentication tag, base64url (16 bytes)
  createdAt: string;              // ISO 8601
  updatedAt: string;              // ISO 8601
}
```

### GitCommit

Returned by `readCommits()`. Not persisted by this module.

```ts
interface GitCommit {
  hash: string;                        // full 40-char SHA
  author: { name: string; email: string };
  timestamp: string;                   // ISO 8601
  message: string;
  changedFiles: string[];              // relative paths from repo root
}
```

### GitFileEntry

Returned by `listFiles()`. Not persisted by this module.

```ts
interface GitFileEntry {
  path: string;    // relative path from repo root, e.g. "src/app.ts"
  size: number;    // bytes
  type: "file" | "directory";
}
```

### GitConnectorConfig

```ts
interface GitConnectorConfig {
  workDir: string;             // base directory for clones, e.g. os.tmpdir() + "/pm-git"
  maxFileSizeBytes: number;    // files over this limit are skipped / readFile returns null; default: 1_048_576 (1 MB)
  defaultCommitLimit: number;  // default N for readCommits(); default: 100
}
```

---

## CredentialStore (`credential-store.ts`)

### Interface

```ts
interface CredentialStore {
  // Create or replace the credential for a repository.
  // plaintext is null for type "none".
  upsertCredential(
    repositoryId: string,
    type: CredentialType,
    plaintext: string | null
  ): Promise<RepositoryCredential>;

  // Returns null if no credential exists for the repository.
  getCredential(repositoryId: string): Promise<RepositoryCredential | null>;

  // No-op if credential does not exist.
  deleteCredential(repositoryId: string): Promise<void>;
}

function createCredentialStore(db: Db, encryptionKey: Buffer): CredentialStore;
```

### Encryption

Uses `node:crypto` — no new dependency:

- Algorithm: `aes-256-gcm`
- Key: 32-byte `Buffer` from `CREDENTIAL_ENCRYPTION_KEY` hex
- IV: 12 random bytes per encrypt call (`crypto.randomBytes(12)`)
- Auth tag: 16 bytes (GCM default)
- Storage: ciphertext, iv, and authTag all stored as `base64url` strings in the document

`upsertCredential` encrypts `plaintext` before writing. `getCredential` returns the encrypted document as-is — callers (i.e. `GitConnector`) call a separate `decryptCredential(credential, encryptionKey)` helper to get the plaintext for use.

The decrypted plaintext is never returned from `CredentialStore` directly, keeping the decryption concern in `GitConnector` where it is used and discarded.

### MongoDB collection

Collection name: `connector_credentials`  
Index: unique on `repositoryId` (supports the upsert pattern).

---

## GitConnector (`git-connector.ts`)

### Interface

```ts
interface GitConnector {
  // Clone the repo if not present locally; fetch + fast-forward if already cloned.
  // Resolves to the absolute local path of the working directory.
  connect(repositoryId: string, cloneUrl: string): Promise<string>;

  // List files under subPath (default: repo root).
  // Directories are included as entries with type "directory".
  // Files over maxFileSizeBytes are still listed with their actual size reported.
  listFiles(repositoryId: string, subPath?: string): Promise<GitFileEntry[]>;

  // Read a single file's UTF-8 content.
  // Returns null if the file exceeds maxFileSizeBytes.
  // Throws FileNotFoundError if path does not exist.
  readFile(repositoryId: string, filePath: string): Promise<string | null>;

  // Returns the most recent `limit` commits on the default branch.
  // Includes changed files per commit (--name-only).
  readCommits(repositoryId: string, limit?: number): Promise<GitCommit[]>;

  // Delete the ephemeral working directory for this repository.
  disconnect(repositoryId: string): Promise<void>;
}

function createGitConnector(
  credentialStore: CredentialStore,
  encryptionKey: Buffer,
  config: GitConnectorConfig
): GitConnector;
```

### Local working directory layout

```
{workDir}/
  {repositoryId}/    # one directory per connected repository
    .git/
    <repo files>
```

`connect()` is idempotent: if `{workDir}/{repositoryId}` already exists and is a valid git repo, it runs `git fetch origin` and fast-forwards the default branch instead of cloning again. This supports reconnect/credential-refresh — `upsertCredential` followed by `connect()` picks up the new credential.

### Auth flow

Credential plaintext is decrypted at the start of `connect()` and used only within that call — not stored as an instance variable.

| `type`        | Mechanism |
|---------------|-----------|
| `"none"`      | Clone URL used as-is. Suitable for public repos over HTTPS. |
| `"token"`     | URL rewritten to `https://x-access-token:<token>@<host>/<path>`. The rewritten URL is passed to `simple-git` and never logged. |
| `"deploy_key"` | Decrypted key written to `{workDir}/.ssh/{repositoryId}` (mode `0600`). `GIT_SSH_COMMAND` set to `ssh -i <keyfile> -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`. Key file deleted in a `finally` block after clone/fetch completes — even on error. |

`simple-git` is instantiated with `{ baseDir: workDir }` and no persistent env; auth env vars are scoped to each clone/fetch call via the `env` option.

### File size guard

`listFiles()` uses `simple-git`'s `raw(["ls-tree", "-r", "-l", "HEAD", "--", subPath])` to get paths and sizes in one call. Files are returned regardless of size — the caller decides what to do. `readFile()` checks size via `fs.stat` before reading and returns `null` for files over `maxFileSizeBytes`.

### Commit log

`readCommits()` calls `git log --format=... --name-only -n <limit>`. Changed files are parsed from the `--name-only` lines between commit entries.

---

## Error handling

New error classes added to `src/lib/errors.ts`, following the existing `AppError` subclass pattern:

| Class | HTTP status | Code |
|---|---|---|
| `CredentialNotFoundError` | 404 | `CREDENTIAL_NOT_FOUND` |
| `GitCloneError` | 502 | `GIT_CLONE_FAILED` |
| `FileNotFoundError` | 404 | `FILE_NOT_FOUND` |

`GitCloneError` wraps the underlying `simple-git` error message. The raw `git` stderr is included in the error's `cause` for debugging but is not surfaced to API callers (aligns with the existing error handler in `src/plugins/error-handler.ts`).

---

## Testing strategy

### `credential-store.test.ts`

- Mock MongoDB collection methods with `vi.fn()` (same pattern as `repository-binding/repository.test.ts`)
- Verify encrypt/decrypt round-trip: the value passed to `insertOne` must not equal the plaintext
- Verify `upsertCredential` uses `replaceOne` with `upsert: true` (not `insertOne`)
- Verify `getCredential` returns `null` when `findOne` returns `null`
- Verify `deleteCredential` calls `deleteOne` with correct filter

### `git-connector.test.ts`

- Mock `simple-git` module with `vi.mock("simple-git")`
- `connect()` — calls `clone` when local dir absent; calls `fetch` when dir exists
- `connect()` — token auth: verify cloneUrl passed to `simpleGit().clone()` contains the token
- `connect()` — deploy key: verify key file created before clone, deleted after (even on error)
- `listFiles()` — maps `ls-tree` output to `GitFileEntry[]` correctly
- `readFile()` — returns `null` for files over `maxFileSizeBytes`; throws `FileNotFoundError` for missing path
- `readCommits()` — maps `git log` output to `GitCommit[]` correctly; respects `limit`

No real git network calls in unit tests. An optional integration test (skip in CI by default, run with `INTEGRATION=true`) may clone a known small public repo.

---

## Acceptance criteria (from issue)

- Connector clones a public GitHub repo without errors (type `"none"`, HTTPS URL)
- `listFiles()` returns accurate paths and sizes
- Credentials are not logged or stored in plaintext — verified by unit tests asserting encrypted storage and no plaintext in MongoDB writes

---

## Out of scope for this issue

- HTTP routes exposing file tree or commits
- Ingestion pipeline wiring (downstream consumers of `GitConnector`)
- GitHub/GitLab REST API connector (no local clone)
- External vault integration (future: replace `CredentialStore` with vault reference)
