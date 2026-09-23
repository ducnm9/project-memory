import { describe, it, expect } from "vitest";
import { createProjectSnapshotStore } from "../../../src/modules/repository-analyzer/snapshot-repository.js";
import { createFakeDb } from "../../support/fake-db.js";
import type { ProjectSnapshot } from "../../../src/modules/repository-analyzer/entities.js";

const snapshot: ProjectSnapshot = {
  analyzedAt: "2026-01-01T00:00:00Z",
  languages: ["TypeScript"],
  frameworks: ["Fastify"],
  buildSystem: "npm",
  testFrameworks: ["Vitest"],
  databases: ["MongoDB"],
  apiStyles: ["REST"],
  entryPoints: ["src/index.ts"],
  modules: [{ name: "api", path: "src/api" }],
  cicd: "GitHub Actions",
  infrastructure: [],
  integrations: [],
  isMonorepo: false,
  dependencies: [],
};

describe("ProjectSnapshotStore", () => {
  it("saves a snapshot and returns it with id and version 1", async () => {
    const { db } = createFakeDb();
    const store = createProjectSnapshotStore(db);
    const saved = await store.save("org_1", "proj_1", snapshot);
    expect(saved.id).toMatch(/^snap_/);
    expect(saved.version).toBe(1);
    expect(saved.archivedAt).toBeNull();
    expect(saved.languages).toEqual(["TypeScript"]);
  });

  it("findCurrent returns null when no snapshot exists", async () => {
    const { db } = createFakeDb();
    const store = createProjectSnapshotStore(db);
    expect(await store.findCurrent("org_1", "proj_1")).toBeNull();
  });

  it("findCurrent returns the latest non-archived snapshot", async () => {
    const { db } = createFakeDb();
    const store = createProjectSnapshotStore(db);
    await store.save("org_1", "proj_1", snapshot);
    const found = await store.findCurrent("org_1", "proj_1");
    expect(found).not.toBeNull();
    expect(found!.version).toBe(1);
  });

  it("re-running save archives the old snapshot and increments version", async () => {
    const { db } = createFakeDb();
    const store = createProjectSnapshotStore(db);
    await store.save("org_1", "proj_1", snapshot);
    const second = await store.save("org_1", "proj_1", { ...snapshot, languages: ["TypeScript", "Python"] });
    expect(second.version).toBe(2);
    const history = await store.findHistory("org_1", "proj_1");
    expect(history).toHaveLength(2);
    const archived = history.find(s => s.version === 1);
    expect(archived!.archivedAt).not.toBeNull();
  });
});
