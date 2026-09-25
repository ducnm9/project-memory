import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";
import { searchKnowledge } from "./search.js";
import { proposeKnowledge } from "./propose.js";
import { analyzeImpact } from "./impact.js";

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  switch (name) {
    case "knowledge.search": return searchKnowledge(args, db, config);
    case "knowledge.propose": return proposeKnowledge(args, db, config);
    case "knowledge.impact": return analyzeImpact(args, db, config);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
