import { extname } from "node:path";
import type { GitFileEntry } from "../git-connector/index.js";
// ── Language detection ────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript",
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python",
  ".java": "Java",
  ".go": "Go",
  ".rs": "Rust",
  ".rb": "Ruby",
  ".cs": "C#",
};

export function detectLanguages(files: GitFileEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.type !== "file") continue;
    const lang = EXT_TO_LANG[extname(f.path)];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

// ── API style detection ───────────────────────────────────────────────────

export function detectApiStyles(files: GitFileEntry[]): string[] {
  const styles = new Set<string>();
  const paths = files.filter(f => f.type === "file").map(f => f.path);
  if (paths.some(p => p.endsWith(".proto"))) styles.add("gRPC");
  if (paths.some(p => p.endsWith(".graphql") || p.endsWith(".gql"))) styles.add("GraphQL");
  if (paths.some(p => /controller|router|\/routes\//i.test(p))) styles.add("REST");
  return [...styles];
}

// ── Entry point detection ─────────────────────────────────────────────────

const KNOWN_ENTRY_POINTS = [
  "src/index.ts", "src/index.js", "src/main.ts", "src/main.js",
  "src/server.ts", "src/app.ts", "index.ts", "index.js",
  "main.go", "cmd/main.go", "app.py", "main.py", "manage.py",
];

export function detectEntryPoints(files: GitFileEntry[]): string[] {
  const filePaths = new Set(files.filter(f => f.type === "file").map(f => f.path));
  return KNOWN_ENTRY_POINTS.filter(p => filePaths.has(p));
}

// ── Module detection ──────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".github",
]);

export function detectModules(files: GitFileEntry[]): Array<{name: string; path: string}> {
  const hasSrc = files.some(f => f.path === "src" || f.path.startsWith("src/"));
  return files
    .filter(f => {
      if (f.type !== "directory") return false;
      const parts = f.path.split("/");
      if (IGNORED_DIRS.has(parts[0])) return false;
      if (hasSrc) return parts.length === 2 && parts[0] === "src";
      return parts.length === 1;
    })
    .map(f => ({ name: f.path.split("/").pop()!, path: f.path }));
}

// ── CI/CD detection ───────────────────────────────────────────────────────

export function detectCicd(files: GitFileEntry[]): string | null {
  const paths = files.map(f => f.path);
  if (paths.some(p => p.startsWith(".github/workflows/"))) return "GitHub Actions";
  if (paths.includes("Jenkinsfile")) return "Jenkins";
  if (paths.includes(".gitlab-ci.yml")) return "GitLab CI";
  if (paths.some(p => p.startsWith(".circleci/"))) return "CircleCI";
  if (paths.includes("bitbucket-pipelines.yml")) return "Bitbucket Pipelines";
  return null;
}

// ── Infrastructure detection ──────────────────────────────────────────────

export function detectInfrastructure(files: GitFileEntry[]): string[] {
  const paths = files.filter(f => f.type === "file").map(f => f.path);
  const infra = new Set<string>();
  if (paths.some(p => p === "Dockerfile" || p.startsWith("docker-compose"))) infra.add("Docker");
  if (paths.some(p => p.endsWith(".tf"))) infra.add("Terraform");
  if (paths.some(p => p.startsWith("k8s/") || p.startsWith("kubernetes/"))) infra.add("Kubernetes");
  if (paths.includes("serverless.yml")) infra.add("Serverless Framework");
  if (paths.includes("cdk.json")) infra.add("AWS CDK");
  return [...infra];
}
