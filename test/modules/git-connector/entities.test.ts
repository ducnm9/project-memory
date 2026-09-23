import { describe, expect, it } from "vitest";
import { newCredentialId } from "../../../src/modules/git-connector/entities.js";

describe("newCredentialId", () => {
  it("returns a string prefixed with 'cred_'", () => {
    expect(newCredentialId()).toMatch(/^cred_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("generates unique ids", () => {
    expect(newCredentialId()).not.toBe(newCredentialId());
  });
});
