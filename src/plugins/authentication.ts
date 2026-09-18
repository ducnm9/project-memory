import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/index.js";
import { UnauthorizedError } from "../lib/errors.js";
import { createTokenRepository } from "../modules/auth/repository.js";
import { resolveActor, type Actor } from "../modules/auth/actor.js";

type AuthPolicy = "public" | "admin" | "bearer";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
  interface FastifyContextConfig {
    auth?: AuthPolicy;
  }
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function registerAuthentication(app: FastifyInstance, config: AppConfig): void {
  app.addHook("onRequest", async (req) => {
    const policy: AuthPolicy = req.routeOptions.config.auth ?? "bearer";
    if (policy === "public") return;

    if (policy === "admin") {
      if (header(req, "x-admin-key") !== config.authAdminKey || config.authAdminKey.length === 0) {
        throw new UnauthorizedError("invalid admin credentials");
      }
      return;
    }

    // bearer
    const repo = createTokenRepository(app.db, config.authTokenPepper);
    req.actor = await resolveActor(repo, config.authTokenPepper, header(req, "authorization"));
  });
}
