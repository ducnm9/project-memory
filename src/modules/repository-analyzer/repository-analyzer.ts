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

// ── Manifest-based detectors ──────────────────────────────────────────────

type Manifests = Record<string, string | null>;

function parsePkgJson(manifests: Manifests): Record<string, string> {
  const raw = manifests["package.json"];
  if (!raw) return {};
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

const PKG_FRAMEWORK_MAP: Array<[string, string]> = [
  ["fastify", "Fastify"], ["express", "Express"], ["react", "React"],
  ["next", "Next.js"], ["vue", "Vue"], ["@nestjs/core", "NestJS"],
];

const PYTHON_FRAMEWORK_MAP: Array<[string, string]> = [
  ["fastapi", "FastAPI"], ["django", "Django"], ["flask", "Flask"],
  ["sqlalchemy", "SQLAlchemy"],
];

const GO_FRAMEWORK_MAP: Array<[string, string]> = [
  ["gin-gonic/gin", "Gin"], ["labstack/echo", "Echo"], ["gofiber/fiber", "Fiber"],
];

export function detectFrameworks(manifests: Manifests): string[] {
  const out = new Set<string>();
  const deps = parsePkgJson(manifests);
  for (const [key, name] of PKG_FRAMEWORK_MAP) {
    if (key in deps) out.add(name);
  }
  const reqs = manifests["requirements.txt"];
  if (reqs) {
    const lower = reqs.toLowerCase();
    for (const [key, name] of PYTHON_FRAMEWORK_MAP) {
      if (lower.includes(key)) out.add(name);
    }
  }
  const goMod = manifests["go.mod"];
  if (goMod) {
    for (const [key, name] of GO_FRAMEWORK_MAP) {
      if (goMod.includes(key)) out.add(name);
    }
  }
  const jvmManifest = manifests["pom.xml"] ?? manifests["build.gradle"];
  if (jvmManifest) {
    if (jvmManifest.includes("spring-boot")) out.add("Spring Boot");
    if (jvmManifest.includes("quarkus")) out.add("Quarkus");
  }
  return [...out];
}

const BUILD_PRECEDENCE: Array<[string, string]> = [
  ["package.json", "npm"], ["pom.xml", "maven"], ["build.gradle", "gradle"],
  ["Makefile", "make"], ["go.mod", "go"], ["Cargo.toml", "cargo"],
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function detectBuildSystem(files: GitFileEntry[], _: Manifests): string | null {
  const filePaths = new Set(files.map(f => f.path));
  for (const [name, system] of BUILD_PRECEDENCE) {
    if (filePaths.has(name)) return system;
  }
  return null;
}

export function detectTestFrameworks(files: GitFileEntry[], manifests: Manifests): string[] {
  const out = new Set<string>();
  const deps = parsePkgJson(manifests);
  if ("vitest" in deps) out.add("Vitest");
  if ("jest" in deps) out.add("Jest");
  if ("mocha" in deps) out.add("Mocha");
  const filePaths = files.map(f => f.path);
  if (filePaths.some(p => p === "pytest.ini" || p === "setup.cfg")) out.add("pytest");
  const pyproject = manifests["pyproject.toml"];
  if (pyproject?.includes("[tool.pytest")) out.add("pytest");
  const jvmManifest = manifests["pom.xml"] ?? manifests["build.gradle"];
  if (jvmManifest?.includes("junit")) out.add("JUnit");
  return [...out];
}

const PKG_DB_MAP: Array<[string, string]> = [
  ["mongodb", "MongoDB"], ["mongoose", "MongoDB"],
  ["pg", "PostgreSQL"], ["postgres", "PostgreSQL"], ["postgresql", "PostgreSQL"],
  ["mysql", "MySQL"], ["mysql2", "MySQL"],
  ["redis", "Redis"], ["ioredis", "Redis"],
  ["sqlite", "SQLite"], ["better-sqlite3", "SQLite"],
];

const PYTHON_DB_MAP: Array<[string, string]> = [
  ["psycopg2", "PostgreSQL"], ["asyncpg", "PostgreSQL"],
  ["pymongo", "MongoDB"],
  ["redis", "Redis"],
  ["mysql-connector", "MySQL"], ["pymysql", "MySQL"],
];

export function detectDatabases(manifests: Manifests): string[] {
  const out = new Set<string>();
  const deps = parsePkgJson(manifests);
  for (const [key, name] of PKG_DB_MAP) {
    if (key in deps) out.add(name);
  }
  const reqs = manifests["requirements.txt"];
  if (reqs) {
    const lower = reqs.toLowerCase();
    for (const [key, name] of PYTHON_DB_MAP) {
      if (lower.includes(key)) out.add(name);
    }
  }
  return [...out];
}

const INTEGRATION_KEYWORDS: Array<[string, string]> = [
  ["stripe", "stripe"], ["twilio", "twilio"],
  ["@sendgrid/", "sendgrid"], ["sendgrid", "sendgrid"],
  ["aws-sdk", "aws-sdk"], ["@aws-sdk/", "aws-sdk"],
  ["firebase", "firebase"], ["supabase", "supabase"],
  ["auth0", "auth0"], ["datadog", "datadog"],
  ["sentry", "sentry"], ["openai", "openai"],
  ["anthropic", "anthropic"], ["langchain", "langchain"],
];

export function detectIntegrations(manifests: Manifests): string[] {
  const out = new Set<string>();
  const deps = parsePkgJson(manifests);
  for (const [key, label] of INTEGRATION_KEYWORDS) {
    if (Object.keys(deps).some(d => d.startsWith(key) || d === key)) out.add(label);
  }
  const reqs = manifests["requirements.txt"];
  if (reqs) {
    const lower = reqs.toLowerCase();
    for (const [key, label] of INTEGRATION_KEYWORDS) {
      if (lower.includes(key.replace("@", "").replace("/", "-"))) out.add(label);
    }
  }
  return [...out];
}

const MONOREPO_SIGNALS = ["pnpm-workspace.yaml", "lerna.json"];
const MULTI_ROOT_FILES = ["package.json", "pom.xml", "go.mod"];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function detectMonorepo(files: GitFileEntry[], _: Manifests): boolean {
  const filePaths = files.filter(f => f.type === "file").map(f => f.path);
  if (MONOREPO_SIGNALS.some(s => filePaths.includes(s))) return true;
  for (const name of MULTI_ROOT_FILES) {
    const matches = filePaths.filter(p => p === name || p.endsWith(`/${name}`));
    if (matches.length > 1) return true;
  }
  return false;
}
