import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "mongodb";
import type { AppConfig } from "../../config/index.js";
import { loadToolRegistry } from "./tool-registry.js";
import { handleToolCall } from "./tools/dispatcher.js";

export async function createMcpServer(db: Db, config: AppConfig): Promise<Server> {
  const tools = await loadToolRegistry();
  const server = new Server(
    { name: "project-memory", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, (args ?? {}) as Record<string, unknown>, db, config);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  });

  return server;
}
