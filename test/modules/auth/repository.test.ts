import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createTokenRepository } from "../../../src/modules/auth/repository.js";
import { newOrgId } from "../../../src/modules/project-context/entities.js";

const orgId = newOrgId();

function dbWith(serviceTokens: Record<string, unknown>): Db {
  return { collection: (n: string) => (n === "service_tokens" ? serviceTokens : {}) } as unknown as Db;
}

describe("createToken", () => {
  it("stores a hashed secret and returns the one-time plaintext secret", async () => {
    const insertOne = vi.fn().mockResolvedValue({});
    const repo = createTokenRepository(dbWith({ insertOne }), "pepper");
    const { token, secret } = await repo.createToken(orgId, "kiro-ci");
    expect(secret).toMatch(/^pmk_/);
    expect(token.id).toMatch(/^tok_/);
    expect(token.organizationId).toBe(orgId);
    expect(token.name).toBe("kiro-ci");
    expect(token.revokedAt).toBeNull();
    // stored doc has a hash, never the plaintext
    const stored = insertOne.mock.calls[0][0];
    expect(stored.hashedSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secret);
  });
});

describe("findActiveByHash", () => {
  it("queries by hash AND revokedAt null", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const repo = createTokenRepository(dbWith({ findOne }), "pepper");
    await repo.findActiveByHash("deadbeef");
    expect(findOne).toHaveBeenCalledWith(
      { hashedSecret: "deadbeef", revokedAt: null },
      expect.anything(),
    );
  });
});

describe("listTokens", () => {
  it("projects away the hashedSecret", async () => {
    const toArray = vi.fn().mockResolvedValue([]);
    const find = vi.fn().mockReturnValue({ toArray });
    const repo = createTokenRepository(dbWith({ find }), "pepper");
    await repo.listTokens(orgId);
    expect(find).toHaveBeenCalledWith({ organizationId: orgId }, expect.anything());
    const projection = find.mock.calls[0][1].projection;
    expect(projection.hashedSecret).toBe(0);
  });
});

describe("revokeToken", () => {
  it("returns true when a token is updated", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const repo = createTokenRepository(dbWith({ updateOne }), "pepper");
    const ok = await repo.revokeToken(orgId, "tok_x");
    expect(ok).toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      { id: "tok_x", organizationId: orgId, revokedAt: null },
      { $set: { revokedAt: expect.any(String) } },
    );
  });

  it("returns false when nothing matched", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const repo = createTokenRepository(dbWith({ updateOne }), "pepper");
    expect(await repo.revokeToken(orgId, "tok_x")).toBe(false);
  });
});
