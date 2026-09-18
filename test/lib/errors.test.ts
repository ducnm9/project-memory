import { describe, expect, it } from "vitest";
import { AppError, NotFoundError, ValidationError } from "../../src/lib/errors.js";
import { InvalidTenantScopeError, TenantNotFoundError } from "../../src/lib/errors.js";

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
