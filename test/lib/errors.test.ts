import { describe, expect, it } from "vitest";
import {
  AppError,
  FactNotFoundError,
  InvalidKnowledgeTypeError,
  InvalidStatusTransitionError,
  KnowledgeNotFoundError,
  NotFoundError,
  RelationNotFoundError,
  ValidationError,
} from "../../src/lib/errors.js";
import { InvalidTenantScopeError, TenantNotFoundError, UnauthorizedError, ForbiddenScopeError } from "../../src/lib/errors.js";

describe("AppError", () => {
  it("carries statusCode and code", () => {
    const err = new AppError("boom", 418, "TEAPOT");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("TEAPOT");
  });

  it("ValidationError maps to 400 / VALIDATION_ERROR", () => {
    const err = new ValidationError("bad input");
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("bad input");
  });

  it("NotFoundError maps to 404 / NOT_FOUND", () => {
    const err = new NotFoundError("missing");
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("missing");
  });
});

describe("tenant errors", () => {
  it("InvalidTenantScopeError is a 400 with INVALID_TENANT_SCOPE", () => {
    const e = new InvalidTenantScopeError("x-organization-id is required");
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe("INVALID_TENANT_SCOPE");
    expect(e.message).toBe("x-organization-id is required");
  });

  it("TenantNotFoundError is a 404 with a fixed non-leaking message", () => {
    const e = new TenantNotFoundError();
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("TENANT_NOT_FOUND");
    expect(e.message).toBe("organization or project not found");
  });
});

describe("UnauthorizedError", () => {
  it("has status 401 and code UNAUTHORIZED", () => {
    const e = new UnauthorizedError("invalid credentials");
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("UNAUTHORIZED");
    expect(e.message).toBe("invalid credentials");
  });
});

describe("ForbiddenScopeError", () => {
  it("has status 403 and code FORBIDDEN_SCOPE", () => {
    const e = new ForbiddenScopeError("token not permitted for this organization");
    expect(e.statusCode).toBe(403);
    expect(e.code).toBe("FORBIDDEN_SCOPE");
  });
});

describe("knowledge errors", () => {
  it("KnowledgeNotFoundError maps to 404 / KNOWLEDGE_NOT_FOUND", () => {
    const e = new KnowledgeNotFoundError();
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("KNOWLEDGE_NOT_FOUND");
  });

  it("InvalidKnowledgeTypeError maps to 422 / INVALID_KNOWLEDGE_TYPE", () => {
    const e = new InvalidKnowledgeTypeError();
    expect(e.statusCode).toBe(422);
    expect(e.code).toBe("INVALID_KNOWLEDGE_TYPE");
  });

  it("InvalidStatusTransitionError maps to 422 and names the edge", () => {
    const e = new InvalidStatusTransitionError("PUBLISHED", "DISCOVERED");
    expect(e.statusCode).toBe(422);
    expect(e.code).toBe("INVALID_STATUS_TRANSITION");
    expect(e.message).toContain("PUBLISHED");
    expect(e.message).toContain("DISCOVERED");
  });
});

describe("FactNotFoundError", () => {
  it("is a 404 with code FACT_NOT_FOUND", () => {
    const err = new FactNotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("FACT_NOT_FOUND");
  });
});

describe("RelationNotFoundError", () => {
  it("is a 404 with RELATION_NOT_FOUND code", () => {
    const err = new RelationNotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("RELATION_NOT_FOUND");
  });
});