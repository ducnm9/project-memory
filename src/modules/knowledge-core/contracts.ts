import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";
import type { KnowledgeType } from "./entities.js";

const nonEmpty = z.string().trim().min(1);
const nonEmptyList = z.array(nonEmpty);

const decision = z
  .object({
    context: nonEmpty,
    problem: nonEmpty,
    decision: nonEmpty,
    alternatives: nonEmptyList.optional(),
    consequences: nonEmpty.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const concept = z
  .object({
    definition: nonEmpty,
    responsibility: nonEmpty.optional(),
    boundaries: nonEmpty.optional(),
    relatedConcepts: nonEmptyList.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const procedure = z
  .object({
    purpose: nonEmpty,
    steps: nonEmptyList,
    prerequisites: nonEmptyList.optional(),
    verification: nonEmpty.optional(),
    failureHandling: nonEmpty.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const troubleshooting = z
  .object({
    symptoms: nonEmpty,
    cause: nonEmpty,
    resolution: nonEmpty,
    diagnosis: nonEmpty.optional(),
    verification: nonEmpty.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const investigation = z
  .object({
    question: nonEmpty,
    observations: nonEmptyList.optional(),
    hypotheses: nonEmptyList.optional(),
    findings: nonEmpty.optional(),
    conclusion: nonEmpty.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const architecture = z
  .object({
    component: nonEmpty,
    responsibility: nonEmpty,
    dependencies: nonEmptyList.optional(),
    interfaces: nonEmptyList.optional(),
    constraints: nonEmptyList.optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

const fact = z
  .object({
    subject: nonEmpty,
    predicate: nonEmpty,
    object: z.unknown().optional(),
    evidence: nonEmptyList.optional(),
  })
  .strict();

export const CONTENT_SCHEMAS: Record<KnowledgeType, z.ZodTypeAny> = {
  Decision: decision,
  Concept: concept,
  Procedure: procedure,
  Troubleshooting: troubleshooting,
  Investigation: investigation,
  Architecture: architecture,
  Fact: fact,
};

function describeIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((i) => {
      const path = i.path.join(".") || "(root)";
      return `${path}: ${i.message}`;
    })
    .join("; ");
}

export function validateContent(
  type: KnowledgeType,
  content: unknown,
): Record<string, unknown> {
  const result = CONTENT_SCHEMAS[type].safeParse(content);
  if (!result.success) {
    throw new ValidationError(
      `invalid content for type ${type}: ${describeIssues(result.error.issues)}`,
    );
  }
  return result.data as Record<string, unknown>;
}
