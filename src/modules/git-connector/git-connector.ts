import { simpleGit } from "simple-git";
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

      // Two instances: clone needs baseDir=workDir, fetch needs baseDir=localPath.
      // Both get SSH env so deploy key auth works on re-connect (fetch) too.
      const gitClone = simpleGit({ baseDir: config.workDir });
      const gitFetch = simpleGit(localPath);
      if (sshKeyPath) {
        const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`;
        gitClone.env("GIT_SSH_COMMAND", sshCmd);
        gitFetch.env("GIT_SSH_COMMAND", sshCmd);
      }

      try {
        if (existsSync(join(localPath, ".git"))) {
          await gitFetch.fetch("origin");
        } else {
          await mkdir(localPath, { recursive: true });
          await gitClone.clone(gitUrl, localPath);
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
