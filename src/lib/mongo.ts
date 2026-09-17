import { MongoClient, type Db } from "mongodb";
import type { AppConfig } from "../config/index.js";

export type { Db, MongoClient } from "mongodb";

/**
 * Connects a MongoClient using the configured URI and returns the client plus
 * the target database handle. Throws if the initial connection fails
 * (fail-fast at boot).
 */
export async function createMongo(config: AppConfig): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(config.mongodbUri);
  await client.connect();
  const db = client.db(config.mongodbDbName);
  return { client, db };
}

/** Runs a ping command; rejects if the database is unreachable. */
export async function ping(db: Db): Promise<void> {
  await db.command({ ping: 1 });
}

/** Closes the client during graceful shutdown. */
export async function closeMongo(client: MongoClient): Promise<void> {
  await client.close();
}
