import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config/index.js";
import type { Db } from "./lib/mongo.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerTenantContext } from "./plugins/tenant-context.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  db: Db;
}

export function buildApp({ config, db }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  app.decorate("db", db);

  registerErrorHandler(app);
  registerHealthRoutes(app);
  registerTenantContext(app);
  registerOrganizationRoutes(app);

  return app;
}
