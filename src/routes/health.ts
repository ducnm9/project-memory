import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));
  // Readiness aggregates dependency checks. PM-001 has none, so it is always
  // ready. PM-002 adds a DB ping here and returns 503 on failure.
  app.get("/ready", async () => ({ status: "ready" }));
}
