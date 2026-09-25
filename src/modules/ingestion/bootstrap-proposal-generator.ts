import { createHash } from "node:crypto";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { ProposalStore, CreateProposalInput } from "./proposal-repository.js";
import type { KnowledgeProposal } from "./entities.js";
import type { ProjectSnapshot } from "../repository-analyzer/entities.js";

export class BootstrapProposalGenerator {
  constructor(private readonly proposals: ProposalStore) {}

  async generate(
    orgId: string,
    projectId: string,
    snapshot: ProjectSnapshot,
    llmModel: LanguageModel | null,
  ): Promise<{ created: KnowledgeProposal[]; skipped: number }> {
    const candidates = buildCandidates(snapshot);
    const created: KnowledgeProposal[] = [];
    let skipped = 0;

    for (const input of candidates) {
      const full: CreateProposalInput = { ...input, organizationId: orgId, projectId, proposedBy: "system", knowledgeItemId: null, validationResults: [] };

      // Optional: enrich Architecture module summaries with LLM first
      if (llmModel && full.type === "Architecture" && full.title !== "Project Overview") {
        full.summary = await enrichSummary(llmModel, full.title, full.summary).catch(() => full.summary);
      }

      // Hash after enrichment so re-runs match the stored (enriched) summary
      const hash = computeHash(full.type, full.title, full.summary);
      if (await this.proposals.existsByHash(orgId, projectId, hash)) {
        skipped++;
        continue;
      }

      created.push(await this.proposals.create(full));
    }

    return { created, skipped };
  }
}

type CandidateInput = Omit<CreateProposalInput, "organizationId" | "projectId" | "proposedBy" | "knowledgeItemId" | "validationResults">;

function buildCandidates(snap: ProjectSnapshot): CandidateInput[] {
  const candidates: CandidateInput[] = [];

  // 1. Project overview
  candidates.push({
    type: "Architecture",
    title: "Project Overview",
    summary: `${snap.languages.join(", ")} project using ${snap.frameworks.join(", ") || "no detected frameworks"}. Build: ${snap.buildSystem ?? "unknown"}. Test: ${snap.testFrameworks.join(", ") || "none detected"}.`,
    content: {
      component: "Project",
      description: `Languages: ${snap.languages.join(", ")}. Frameworks: ${snap.frameworks.join(", ")}. Databases: ${snap.databases.join(", ")}. API styles: ${snap.apiStyles.join(", ")}.`,
    },
    sourceIds: [],
    triggeredBy: "bootstrap",
  });

  // 2. One Architecture proposal per module
  for (const mod of snap.modules) {
    candidates.push({
      type: "Architecture",
      title: `Module: ${mod.name}`,
      summary: mod.responsibility ?? `Source module located at ${mod.path}.`,
      content: { component: mod.name, description: mod.responsibility ?? `Located at ${mod.path}` },
      sourceIds: [],
      triggeredBy: "bootstrap",
    });
  }

  // 3. Tech choice Decisions (frameworks + databases)
  const techChoices = [
    ...snap.frameworks.map((f) => ({ title: `Use ${f}`, summary: `${f} is used as a framework in this project.` })),
    ...snap.databases.map((d) => ({ title: `Use ${d}`, summary: `${d} is used as the database.` })),
  ];
  for (const choice of techChoices) {
    candidates.push({ type: "Decision", ...choice, content: {}, sourceIds: [], triggeredBy: "bootstrap" });
  }

  // 4. CI/CD
  if (snap.cicd) {
    candidates.push({
      type: "Architecture",
      title: `CI/CD: ${snap.cicd}`,
      summary: `This project uses ${snap.cicd} for continuous integration and deployment.`,
      content: { component: "CI/CD", description: snap.cicd },
      sourceIds: [],
      triggeredBy: "bootstrap",
    });
  }

  // 5. Module dependency relations (Investigation = proxy for Relation)
  for (const dep of snap.dependencies) {
    const fromName = dep.from.split("/").pop() ?? dep.from;
    const toName = dep.to.split("/").pop() ?? dep.to;
    candidates.push({
      type: "Investigation",
      title: `${fromName} depends on ${toName}`,
      summary: `Module ${dep.from} has a ${dep.type} dependency on module ${dep.to}.`,
      content: { predicate: "depends_on", fromModule: dep.from, toModule: dep.to },
      sourceIds: [],
      triggeredBy: "bootstrap",
    });
  }

  return candidates;
}

async function enrichSummary(model: LanguageModel, title: string, fallback: string): Promise<string> {
  const { text } = await generateText({
    model,
    prompt: `Write a single concise sentence describing the architectural component: "${title}"`,
    maxTokens: 80,
  });
  return text.trim() || fallback;
}

function computeHash(type: string, title: string, summary: string): string {
  return createHash("sha256").update(`${type}:${title}:${summary}`).digest("hex");
}
