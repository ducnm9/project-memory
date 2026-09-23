import type { GitFileEntry } from "../git-connector/entities.js";
import type { ModuleDependency, ProjectModule } from "../repository-analyzer/entities.js";

// Regexes to match import/require statements across TS/JS, Python, Java/Kotlin
const IMPORT_PATTERNS = [
  /(?:import|from)\s+['"]([^'"]+)['"]/g,   // TS/JS: import x from '...' or from '...'
  /require\(['"]([^'"]+)['"]\)/g,           // JS: require('...')
  /^(?:import|from)\s+([\w.]+)/gm,         // Python: import x / from x import
  /^import\s+([\w.]+)/gm,                  // Java/Kotlin
];

export class ArchitectureExtractor {
  async extract(
    files: GitFileEntry[],
    modules: ProjectModule[],
    readFile: (path: string) => Promise<string | null>,
  ): Promise<ModuleDependency[]> {
    const edges = new Set<string>();
    const result: ModuleDependency[] = [];

    const sourceFiles = files.filter(f =>
      f.type === "file" &&
      /\.(ts|tsx|js|jsx|py|java|kt)$/.test(f.path),
    );

    for (const file of sourceFiles) {
      const fromModule = modules.find(m => file.path.startsWith(m.path + "/"));
      if (!fromModule) continue;

      const content = await readFile(file.path);
      if (!content) continue;

      const refs = extractImportPaths(content);
      for (const ref of refs) {
        const toModule = resolveModule(ref, file.path, modules);
        if (!toModule || toModule.path === fromModule.path) continue;

        const key = `${fromModule.path}→${toModule.path}`;
        if (edges.has(key)) continue;
        edges.add(key);
        result.push({ from: fromModule.path, to: toModule.path, type: "import" });
      }
    }

    return result;
  }
}

function extractImportPaths(content: string): string[] {
  const paths: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    let match;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(content)) !== null) {
      paths.push(match[1]);
    }
  }
  return paths;
}

function resolveModule(
  importPath: string,
  fromFile: string,
  modules: ProjectModule[],
): ProjectModule | null {
  // Convert relative path to absolute
  if (importPath.startsWith(".")) {
    const dir = fromFile.split("/").slice(0, -1).join("/");
    const parts = (dir + "/" + importPath).split("/");
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === "..") resolved.pop();
      else if (part && part !== ".") resolved.push(part);
    }
    importPath = resolved.join("/");
  }
  // Match against module path prefixes (longest match wins)
  return modules
    .filter(m => importPath.startsWith(m.path))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}
