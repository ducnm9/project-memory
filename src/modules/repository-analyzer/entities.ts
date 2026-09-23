import type { GitFileEntry } from "../git-connector/index.js";

export interface RepositoryInput {
  files: GitFileEntry[];
  readFile(path: string): Promise<string | null>;
}

export interface LLMAssistant {
  inferModuleResponsibility(
    name: string,
    sampleFiles: string[]
  ): Promise<string | null>;
}

export interface ProjectModule {
  name: string;
  path: string;
  responsibility?: string;
}

export interface ModuleDependency {
  from: string;   // module path prefix
  to: string;     // module path prefix
  type: "import" | "require" | "include";
}

export interface ProjectSnapshot {
  analyzedAt: string;          // ISO 8601
  languages: string[];         // e.g. ["TypeScript", "Python"]
  frameworks: string[];        // e.g. ["Fastify", "React"]
  buildSystem: string | null;  // e.g. "npm" | "gradle" | null
  testFrameworks: string[];    // e.g. ["Vitest", "pytest"]
  databases: string[];         // e.g. ["MongoDB", "PostgreSQL"]
  apiStyles: string[];         // e.g. ["REST", "GraphQL", "gRPC"]
  entryPoints: string[];       // e.g. ["src/index.ts"]
  modules: ProjectModule[];
  dependencies: ModuleDependency[];
  cicd: string | null;         // e.g. "GitHub Actions" | null
  infrastructure: string[];    // e.g. ["Docker", "Terraform"]
  integrations: string[];      // e.g. ["stripe", "aws-sdk"]
  isMonorepo: boolean;
}
