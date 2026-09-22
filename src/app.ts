import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config/index.js";
import type { Db } from "./lib/mongo.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerTenantContext } from "./plugins/tenant-context.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";
import { registerAuthentication } from "./plugins/authentication.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerRepositoryRoutes } from "./routes/repositories.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerKnowledgeVersionRoutes } from "./routes/knowledge-versions.js";
import { registerSourceRoutes } from "./routes/sources.js";

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
  registerAuthentication(app, config);
  registerTenantContext(app);
  registerOrganizationRoutes(app);
  registerRepositoryRoutes(app);
  registerKnowledgeRoutes(app);
  registerKnowledgeVersionRoutes(app);
  registerSourceRoutes(app);
  registerTokenRoutes(app, config.authTokenPepper);

  return app;
}
