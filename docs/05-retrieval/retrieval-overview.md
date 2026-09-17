# 05 — Retrieval & Answering

## Principle

Vector similarity alone is insufficient for engineering knowledge.

## Retrieval pipeline

```text
User / Agent Query
        ↓
Query understanding
        ↓
┌───────┼────────┬────────────┐
↓       ↓        ↓            ↓
Text   Vector   Metadata   Project scope
Search Search    Filter
└───────┼────────┴────────────┘
        ↓
Candidate set
        ↓
Reranking
        ↓
Relation expansion
        ↓
Evidence selection
        ↓
Context assembly
        ↓
Answer
```

## Retrieval signals

- lexical relevance;
- semantic similarity;
- exact identifiers;
- project scope;
- knowledge type;
- status;
- freshness;
- source authority;
- relation proximity.

## Relation expansion

```text
Matter History
      │
      └── depends_on → AuditLog
                           │
                           └── uses → AuditDetailsV2
```

This lets a query discover connected knowledge even when terminology differs.

## Evidence-aware context

Return:

- knowledge type;
- status;
- relevant content;
- sources;
- relations;
- version;
- verification time.

## Answer policy

If evidence is insufficient:

- state that project memory does not contain enough supported information;
- show useful sources when appropriate;
- optionally create a knowledge gap;
- do not invent a project-specific fact.

## Search modes

### Search
Ranked knowledge items.

### Ask
Retrieval + evidence-backed synthesis.

### Related
Explicit + semantic relationships.

### Impact
Knowledge potentially affected by changing a component/API/module/decision.
