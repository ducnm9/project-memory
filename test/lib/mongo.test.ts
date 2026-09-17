import { describe, expect, it, vi } from "vitest";
import type { Db, MongoClient } from "mongodb";
import { closeMongo, ping } from "../../src/lib/mongo.js";

describe("ping", () => {
  it("resolves when the ping command succeeds", async () => {
    const db = { command: vi.fn().mockResolvedValue({ ok: 1 }) } as unknown as Db;
    await expect(ping(db)).resolves.toBeUndefined();
    expect(db.command).toHaveBeenCalledWith({ ping: 1 });
  });

  it("rejects when the ping command fails", async () => {
    const db = { command: vi.fn().mockRejectedValue(new Error("no conn")) } as unknown as Db;
    await expect(ping(db)).rejects.toThrow("no conn");
  });
});

describe("closeMongo", () => {
  it("closes the client", async () => {
    const client = { close: vi.fn().mockResolvedValue(undefined) } as unknown as MongoClient;
    await closeMongo(client);
    expect(client.close).toHaveBeenCalledOnce();
  });
});
