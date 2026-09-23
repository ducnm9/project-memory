import { describe, it, expect } from "vitest";
import { ArchitectureExtractor } from "../../../src/modules/ingestion/architecture-extractor.js";
import type { GitFileEntry } from "../../../src/modules/git-connector/entities.js";
import type { ProjectModule } from "../../../src/modules/repository-analyzer/entities.js";

const files: GitFileEntry[] = [
  { path: "src/auth/index.ts", size: 100, type: "file" },
  { path: "src/api/index.ts", size: 100, type: "file" },
  { path: "src/db/index.ts", size: 100, type: "file" },
];

const modules: ProjectModule[] = [
  { name: "auth", path: "src/auth" },
  { name: "api", path: "src/api" },
  { name: "db", path: "src/db" },
];

async function readFile(path: string): Promise<string | null> {
  if (path === "src/api/index.ts") return `import { login } from '../auth/index.js';\nimport { query } from '../db/index.js';`;
  if (path === "src/auth/index.ts") return `import { query } from '../db/index.js';`;
  return null;
}

describe("ArchitectureExtractor", () => {
  it("extracts cross-module import edges", async () => {
    const extractor = new ArchitectureExtractor();
    const deps = await extractor.extract(files, modules, readFile);
    expect(deps).toContainEqual({ from: "src/api", to: "src/auth", type: "import" });
    expect(deps).toContainEqual({ from: "src/api", to: "src/db", type: "import" });
    expect(deps).toContainEqual({ from: "src/auth", to: "src/db", type: "import" });
  });

  it("excludes intra-module imports", async () => {
    const selfFiles: GitFileEntry[] = [{ path: "src/api/helper.ts", size: 10, type: "file" }];
    const deps = await new ArchitectureExtractor().extract(
      selfFiles, modules,
      async () => `import { x } from './utils.js';`,
    );
    expect(deps).toHaveLength(0);
  });

  it("deduplicates identical edges", async () => {
    const deps = await new ArchitectureExtractor().extract(files, modules, readFile);
    const apiToDb = deps.filter(d => d.from === "src/api" && d.to === "src/db");
    expect(apiToDb).toHaveLength(1);
  });
});
