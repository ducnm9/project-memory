import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const TOOLS_DIR = join(__dirname, "../../../specs/mcp/tools");

export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export async function loadToolRegistry(): Promise<ToolSchema[]> {
  const files = (await readdir(TOOLS_DIR)).filter(f => f.endsWith(".json"));
  const tools: ToolSchema[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(TOOLS_DIR, file), "utf-8"));
    // Normalise both spec shapes: {title, properties} and {name, inputSchema}
    tools.push({
      name: raw.name ?? raw.title,
      description: raw.description,
      inputSchema: raw.inputSchema ?? {
        type: "object",
        properties: raw.properties ?? {},
        required: raw.required ?? [],
        ...(raw.additionalProperties !== undefined && { additionalProperties: raw.additionalProperties }),
      },
    });
  }
  return tools;
}
