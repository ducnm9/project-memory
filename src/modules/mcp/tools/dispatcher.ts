import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  void args; void db; void config;
  // ponytail: stub — Task 7 wires actual handlers per tool
  throw new Error(`Unknown tool: ${name}`);
}
