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
