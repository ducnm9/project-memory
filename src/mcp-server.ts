import { loadConfig } from "./config/index.js";
import { createMongo } from "./lib/mongo.js";
import { ensureIndexes } from "./lib/indexes.js";
import { createMcpServer } from "./modules/mcp/server.js";
import { connectStdioTransport } from "./modules/mcp/transports.js";

async function main() {
  const config = loadConfig();
  const { db } = await createMongo(config);
  await ensureIndexes(db);
  const server = await createMcpServer(db, config);
  await connectStdioTransport(server);
  process.stderr.write("Project Memory MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err}\n`);
  process.exit(1);
});
