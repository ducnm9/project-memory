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
