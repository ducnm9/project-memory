import type { KnowledgeType } from "../knowledge-core/entities.js";

export interface FreshnessConfig {
  ttlDays: Partial<Record<KnowledgeType, number>>;
}

export const DEFAULT_TTL_DAYS: Record<KnowledgeType, number> = {
  Procedure: 30,
  Troubleshooting: 60,
  Architecture: 90,
  Decision: 90,
  Concept: 180,
  Investigation: 180,
};

export function getTtlDays(config: FreshnessConfig, type: KnowledgeType): number {
  return config.ttlDays[type] ?? DEFAULT_TTL_DAYS[type];
}
