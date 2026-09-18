import type { FastifyInstance, FastifyReply } from "fastify";
import { ping } from "../lib/mongo.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", { config: { auth: "public" } }, async () => ({ status: "ok" }));

  // Readiness aggregates dependency checks. PM-002: ping MongoDB; 503 on failure.
  app.get("/ready", { config: { auth: "public" } }, async (_req, reply: FastifyReply) => {
    try {
      await ping(app.db);
      return { status: "ready" };
    } catch (err) {
      app.log.warn({ err }, "readiness check failed: mongo ping");
      reply.status(503);
      return { status: "not ready" };
    }
  });
}
