import { describe, expect, it } from "vitest";
import { validateContent, CONTENT_SCHEMAS } from "../../../src/modules/knowledge-core/contracts.js";
import { KNOWLEDGE_TYPES } from "../../../src/modules/knowledge-core/entities.js";
import { ValidationError } from "../../../src/lib/errors.js";

const validSamples: Record<string, Record<string, unknown>> = {
  Decision: { context: "c", problem: "p", decision: "d" },
  Concept: { definition: "d" },
  Procedure: { purpose: "p", steps: ["one"] },
  Troubleshooting: { symptoms: "s", cause: "c", resolution: "r" },
  Investigation: { question: "q" },
  Architecture: { component: "c", responsibility: "r" },
};

describe("CONTENT_SCHEMAS", () => {
  it("has a schema for every knowledge type", () => {
    for (const type of KNOWLEDGE_TYPES) {
      expect(CONTENT_SCHEMAS[type]).toBeDefined();
    }
  });
});

describe("validateContent", () => {
  it("accepts minimal valid content for each type", () => {
    for (const type of KNOWLEDGE_TYPES) {
      const sample = validSamples[type];
      expect(validateContent(type, sample)).toEqual(sample);
    }
  });

  it("throws ValidationError when a required field is missing", () => {
    expect(() => validateContent("Decision", { context: "c", problem: "p" })).toThrow(ValidationError);
  });

  it("throws ValidationError on an unknown field (strict)", () => {
    expect(() => validateContent("Concept", { definition: "d", bogus: "x" })).toThrow(ValidationError);
  });

  it("names the type in the error message", () => {
    expect(() => validateContent("Decision", {})).toThrow(/Decision/);
  });

  it("trims string fields and strips nothing extra", () => {
    expect(validateContent("Concept", { definition: "  hi  " })).toEqual({ definition: "hi" });
  });
});
