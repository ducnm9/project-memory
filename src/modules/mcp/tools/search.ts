import type { Db } from "mongodb";
import type { AppConfig } from "../../../config/index.js";
import { HybridRetriever } from "../../retrieval/hybrid-retriever.js";
import { SearchIndexer } from "../../retrieval/search-indexer.js";
import { VectorSearchService } from "../../retrieval/vector-search.js";

export async function searchKnowledge(
  args: Record<string, unknown>,
  db: Db,
  config: AppConfig,
): Promise<unknown> {
  const query = args.query;
  if (typeof query !== "string" || query.trim().length === 0) throw new Error("query is required");
  const limit = typeof args.limit === "number" ? args.limit : 10;

  const indexer = new SearchIndexer(db);
  const vectorSearch = new VectorSearchService(db, config.embedding);
  const retriever = new HybridRetriever(indexer, vectorSearch);

  const results = await retriever.search({
    orgId: typeof args.orgId === "string" ? args.orgId : "",
    query: query.trim(),
    projectId: typeof args.projectId === "string" ? args.projectId : "",
    limit,
  });
  return { results };
}
