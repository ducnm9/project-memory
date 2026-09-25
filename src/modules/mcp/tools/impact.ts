import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";
import { ImpactAnalyzer } from "../../retrieval/impact-analyzer.js";

export async function analyzeImpact(
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  const componentId = args.componentId;
  const projectId = args.projectId;
  if (typeof componentId !== "string") throw new Error("componentId is required");
  if (typeof projectId !== "string") throw new Error("projectId is required");

  const analyzer = new ImpactAnalyzer(db, config.embedding ?? undefined);
  const orgId = typeof args.orgId === "string" ? args.orgId : "";
  // ImpactAnalyzer.analyze(orgId, projectId, componentId) — note: projectId before componentId
  const impacts = await analyzer.analyze(orgId, projectId, componentId);
  return { componentId, impacts };
}
