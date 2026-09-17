import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config/index.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerHealthRoutes } from "./routes/health.js";

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  registerErrorHandler(app);
  registerHealthRoutes(app);

  return app;
}
