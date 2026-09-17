# 09 — Evaluation & Observability

## Retrieval metrics

- Recall@K;
- Precision@K;
- MRR;
- NDCG;
- evidence/citation coverage;
- project-scope correctness;
- stale-result rate.

## Answer metrics

- factual grounding;
- evidence correctness;
- unsupported-claim rate;
- completeness;
- usefulness.

## Governance metrics

- proposal approval rate;
- duplicate proposal rate;
- contradiction detection rate;
- stale knowledge rate;
- review time;
- knowledge gap frequency;
- knowledge update latency.

## Agent metrics

- searches per task;
- knowledge reuse;
- repeated unanswered questions;
- proposals generated;
- accepted knowledge generated from agent work.

## Trace

```text
request
  ↓
project resolution
  ↓
query processing
  ↓
candidate retrieval
  ↓
reranking
  ↓
relation expansion
  ↓
context assembly
  ↓
answer
```

Capture request ID, project, actor, filters, candidate counts, selected evidence, latency, model/provider, and errors.

## Evaluation dataset

Include onboarding, architecture, why/how, troubleshooting, exact entity lookup, relationship, stale/conflict, and permission-isolation cases.

## Production gates

- retrieval benchmark passes threshold;
- no cross-tenant retrieval;
- required evidence is present;
- audit is complete;
- ingestion is idempotent;
- stale handling works.
