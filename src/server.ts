import { buildApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { closeMongo, createMongo } from "./lib/mongo.js";
import { ensureIndexes } from "./lib/indexes.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, db } = await createMongo(config);
  await ensureIndexes(db);

  const app = buildApp({ config, db });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await closeMongo(client);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    await closeMongo(client);
    process.exit(1);
  }
}

main().catch((err) => {
  // Config validation, mongo connect/index bootstrap, or unexpected startup failure.
  console.error(err);
  process.exit(1);
});
