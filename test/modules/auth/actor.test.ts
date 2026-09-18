import { describe, expect, it } from "vitest";
import { parseBearer, resolveActor } from "../../../src/modules/auth/actor.js";
import type { TokenRepository } from "../../../src/modules/auth/repository.js";
import type { ServiceToken } from "../../../src/modules/auth/entities.js";
import { newOrgId } from "../../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function repoReturning(token: ServiceToken | null): TokenRepository {
  return {
    createToken: async () => { throw new Error("unused"); },
    findActiveByHash: async () => token,
    listTokens: async () => [],
    revokeToken: async () => false,
  };
}

describe("parseBearer", () => {
  it("extracts the secret from a Bearer header", () => {
    expect(parseBearer("Bearer pmk_abc")).toBe("pmk_abc");
  });

  it("throws on a missing header", () => {
    expect(() => parseBearer(undefined)).toThrow(/missing or malformed/);
  });

  it("throws on a non-Bearer scheme", () => {
    expect(() => parseBearer("Basic abc")).toThrow(/missing or malformed/);
  });
});

describe("resolveActor", () => {
  it("returns a service actor for an active token", async () => {
    const token: ServiceToken = {
      id: "tok_x", organizationId: orgId, name: "n", prefix: "pmk_x",
      hashedSecret: "h", createdAt: "", revokedAt: null,
    };
    const actor = await resolveActor(repoReturning(token), "pepper", "Bearer pmk_abc");
    expect(actor).toEqual({ actorId: "tok_x", organizationId: orgId, type: "service" });
  });

  it("throws invalid credentials when no active token matches", async () => {
    await expect(resolveActor(repoReturning(null), "pepper", "Bearer pmk_abc")).rejects.toThrow(
      /invalid credentials/,
    );
  });

  it("throws missing/malformed when the header is absent", async () => {
    await expect(resolveActor(repoReturning(null), "pepper", undefined)).rejects.toThrow(
      /missing or malformed/,
    );
  });
});
