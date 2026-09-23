import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

// --- mock simple-git ---
const mockGitInstance = {
  clone: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn().mockResolvedValue(undefined),
  raw: vi.fn().mockResolvedValue(""),
  env: vi.fn(),
};
mockGitInstance.env.mockReturnValue(mockGitInstance);

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGitInstance),
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
    } as unknown as Db;
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
    } as unknown as Db;
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
    } as unknown as Db;
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

  it("sets GIT_SSH_COMMAND on fetch path (existing .git dir)", async () => {
    mockExistsSync.mockReturnValue(true);
    const { createCredentialStore } = await import(
      "../../../src/modules/git-connector/credential-store.js"
    );
    const fakeDb = {
      collection: vi.fn(() => ({
        replaceOne: vi.fn().mockResolvedValue({}),
        findOne: vi.fn().mockResolvedValue(null),
        deleteOne: vi.fn().mockResolvedValue({}),
      })),
    } as unknown as Db;
    const realStore = createCredentialStore(fakeDb, TEST_KEY);
    const credential = await realStore.upsertCredential("repo_1", "deploy_key", "mykey");
    const keyCredStore = {
      ...noCredStore,
      getCredential: vi.fn().mockResolvedValue(credential),
    };
    const connector = makeConnector(keyCredStore);
    await connector.connect("repo_1", "git@github.com:org/repo.git");

    expect(mockGitInstance.clone).not.toHaveBeenCalled();
    expect(mockGitInstance.fetch).toHaveBeenCalledWith("origin");
    expect(mockGitInstance.env).toHaveBeenCalledWith(
      "GIT_SSH_COMMAND",
      expect.stringContaining("/tmp/pm-git/.ssh/repo_1"),
    );
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
