import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }

    // Fastify's built-in validation errors carry a numeric statusCode of 400.
    const maybe = error as { statusCode?: number; message?: string };
    if (maybe.statusCode === 400) {
      reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: maybe.message ?? "Bad Request" },
      });
      return;
    }

    app.log.error(error);
    reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal Server Error" },
    });
  });
}
