import { buildApp } from "./app.js";
import { loadConfig } from "./config/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  // Config validation or unexpected startup failure.
  console.error(err);
  process.exit(1);
});
