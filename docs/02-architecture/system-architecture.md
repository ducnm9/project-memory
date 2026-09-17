# 02 — System Architecture

## Target architecture

```text
                       ENGINEERING INTELLIGENCE PLATFORM
┌─────────────────────────────────────────────────────────────────────┐
│ MCP / Web API                                                       │
│   ├─ Project Context                                                │
│   ├─ Knowledge Core                                                 │
│   │    ├─ Knowledge Items ├─ Facts ├─ Relations                    │
│   │    ├─ Versions ├─ Provenance └─ Audit                           │
│   ├─ Retrieval Engine                                               │
│   │    ├─ Full-text ├─ Vector ├─ Metadata ├─ Reranking              │
│   │    └─ Relation expansion                                        │
│   └─ Governance                                                     │
│        ├─ Validation ├─ Duplicate ├─ Contradiction ├─ Freshness     │
│        └─ Proposal / Approval                                       │
│                                                                     │
│ Ingestion: GitHub | Git | Jira | Docs | S3 | Runtime | Human | Agent│
└─────────────────────────────────────────────────────────────────────┘
              ▲
              │ MCP / HTTPS
┌─────────────┴───────────────────────────────────────────────────────┐
│ Kiro | OpenCode | Claude Code | Cursor | Internal Agents            │
└─────────────────────────────────────────────────────────────────────┘
```

## Logical layers

1. Client/Agent
2. MCP/API
3. Project Context
4. Knowledge Core
5. Retrieval
6. Ingestion
7. Governance

## AWS reference alignment

The supplied Kiro/AWS design is a useful retrieval infrastructure pattern:

```text
Kiro → MCP → Bedrock Knowledge Base → OpenSearch
                                  ↑
                                  S3
```

For Project Memory:

```text
Kiro / Agents
      ↓
MCP
      ↓
Project Memory API
      ├── Knowledge Core
      ├── Retrieval
      ├── Governance
      └── Ingestion
             ↓
      Bedrock / OpenSearch / S3
```

AWS services are implementation choices, not the product boundary.

## Storage strategy

MVP can use:

- MongoDB for canonical knowledge, facts, relations, versions, provenance, and audit references;
- OpenSearch or MongoDB Atlas Vector Search for retrieval;
- object storage for large/raw artifacts;
- Bedrock for embeddings/LLM services when using AWS.

Do not introduce a dedicated graph database in MVP. Relations can initially be stored as subject-predicate-object documents.

## Deployment principles

- keep sensitive source data within approved cloud boundaries;
- enforce authorization before retrieval;
- return only permitted context;
- make ingestion idempotent;
- make audit events immutable;
- design search/indexes for eventual consistency.
