import { describe, it, expect } from "vitest";
import { BootstrapProposalGenerator } from "../../../src/modules/ingestion/bootstrap-proposal-generator.js";
import { createProposalStore } from "../../../src/modules/ingestion/proposal-repository.js";
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
  entryPoints: ["src/server.ts"],
  modules: [
    { name: "api", path: "src/api", responsibility: "handles HTTP requests" },
    { name: "db", path: "src/db", responsibility: "database access" },
  ],
  cicd: "GitHub Actions",
  infrastructure: ["Docker"],
  integrations: ["stripe"],
  isMonorepo: false,
  dependencies: [{ from: "src/api", to: "src/db", type: "import" }],
};

describe("BootstrapProposalGenerator", () => {
  it("generates at least 5 proposals from a snapshot", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    expect(created.length).toBeGreaterThanOrEqual(5);
  });

  it("all generated proposals have VALIDATING status", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    expect(created.every(p => p.status === "VALIDATING")).toBe(true);
  });

  it("all proposals have triggeredBy=bootstrap", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    expect(created.every(p => p.triggeredBy === "bootstrap")).toBe(true);
  });

  it("re-running returns skipped > 0 and created = 0", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    await gen.generate("org_1", "proj_1", snapshot, null);
    const second = await gen.generate("org_1", "proj_1", snapshot, null);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it("generates Architecture type for project overview", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    const arch = created.filter(p => p.type === "Architecture");
    expect(arch.length).toBeGreaterThanOrEqual(1);
  });

  it("generates Relation proposals for module dependencies", async () => {
    const { db } = createFakeDb();
    const store = createProposalStore(db);
    const gen = new BootstrapProposalGenerator(store);
    const { created } = await gen.generate("org_1", "proj_1", snapshot, null);
    // Dependency: api → db should produce at least one relation proposal (Investigation = Relation proxy)
    const relProposals = created.filter(p => p.content?.predicate === "depends_on");
    expect(relProposals.length).toBeGreaterThanOrEqual(1);
  });
});
