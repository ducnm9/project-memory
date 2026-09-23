import type { FastifyInstance } from "fastify";

export function registerAuditEventRoutes(app: FastifyInstance): void {
  const BEARER = { config: { auth: "bearer" as const } };

  app.patch("/audit-events/:id", BEARER, async (_req, reply) => {
    reply.status(405);
    return { error: { code: "METHOD_NOT_ALLOWED", message: "AuditEvents are immutable" } };
  });

  app.delete("/audit-events/:id", BEARER, async (_req, reply) => {
    reply.status(405);
    return { error: { code: "METHOD_NOT_ALLOWED", message: "AuditEvents are immutable" } };
  });
}
