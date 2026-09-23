import { describe, it, expect } from "vitest";
import { createLLMModel, createLLMAssistant } from "../../src/lib/llm.js";
import type { AppConfig } from "../../src/config/index.js";

const base: AppConfig = {
  port: 3000, host: "0.0.0.0", nodeEnv: "test",
  logLevel: "silent", mongodbUri: "x", mongodbDbName: "x",
  authAdminKey: "", authTokenPepper: "", credentialEncryptionKey: "0".repeat(64),
  llm: null,
};

describe("createLLMModel", () => {
  it("returns null when llm config is null", () => {
    expect(createLLMModel({ ...base, llm: null })).toBeNull();
  });

  it("returns a model object when openai is configured", () => {
    const model = createLLMModel({
      ...base,
      llm: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" },
    });
    expect(model).not.toBeNull();
  });
});

describe("createLLMAssistant", () => {
  it("returns null when llm config is null", () => {
    expect(createLLMAssistant({ ...base, llm: null })).toBeNull();
  });

  it("returns an LLMAssistant with inferModuleResponsibility", () => {
    const assistant = createLLMAssistant({
      ...base,
      llm: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" },
    });
    expect(assistant).not.toBeNull();
    expect(typeof assistant!.inferModuleResponsibility).toBe("function");
  });
});
