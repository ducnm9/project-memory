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
