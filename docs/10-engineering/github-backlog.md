# 10 — GitHub Implementation Backlog

## Epic 1 — Foundation

- PM-001 — Backend service/repository structure
- PM-002 — MongoDB setup and indexes
- PM-003 — Organization/project tenancy
- PM-004 — Authentication/service identity
- PM-005 — Repository-to-project binding

## Epic 2 — Knowledge Core

- PM-010 — KnowledgeItem model
- PM-011 — Typed knowledge contracts
- PM-012 — Versioning
- PM-013 — Provenance/source model
- PM-014 — Fact model
- PM-015 — Relation model
- PM-016 — Immutable AuditEvent
- PM-017 — KnowledgeGap

## Epic 3 — Bootstrap

- PM-020 — Git connector
- PM-021 — Repository analyzer
- PM-022 — Project snapshot
- PM-023 — Initial knowledge proposals
- PM-024 — Incremental sync
- PM-025 — Architecture/module/dependency extraction

## Epic 4 — Retrieval

- PM-030 — Searchable representation
- PM-031 — Embedding pipeline
- PM-032 — Vector search
- PM-033 — Hybrid retrieval
- PM-034 — Reranking
- PM-035 — Relation expansion
- PM-036 — Evidence-aware context assembly
- PM-037 — Impact analysis retrieval

## Epic 5 — Governance

- PM-040 — Structural validation
- PM-041 — Duplicate detection
- PM-042 — Contradiction detection
- PM-043 — Evidence validation
- PM-044 — Freshness detection
- PM-045 — Proposal lifecycle
- PM-046 — Human review
- PM-047 — Conflict resolution

## Epic 6 — MCP

- PM-050 — MCP server foundation
- PM-051 — project.resolve/bootstrap
- PM-052 — Read tools
- PM-053 — Write/proposal tools
- PM-054 — MCP authorization
- PM-055 — Agent audit logging
- PM-056 — MCP documentation

## Epic 7 — GitHub/Jira

- PM-060 — GitHub App/OAuth
- PM-061 — Webhooks
- PM-062 — PR ingestion
- PM-063 — Commit ingestion
- PM-064 — Issue ingestion
- PM-065 — Jira connector
- PM-066 — PR/issue knowledge extraction

## Epic 8 — Console

- PM-070 — Project dashboard
- PM-071 — Knowledge explorer
- PM-072 — Knowledge detail/evidence
- PM-073 — Proposal review UI
- PM-074 — Version/audit UI
- PM-075 — Relationship explorer
- PM-076 — Knowledge gaps dashboard

## Epic 9 — AGENTS projection

- PM-090 — Generate concise AGENTS.md
- PM-091 — Detect AGENTS.md staleness
- PM-092 — Optional PR generation

## Epic 10 — Quality & Operations

- PM-100 — Unit/integration tests
- PM-101 — Retrieval evaluation dataset
- PM-102 — Retrieval benchmark
- PM-103 — Security/tenant isolation tests
- PM-104 — Observability/tracing
- PM-105 — Ingestion idempotency
- PM-106 — Prompt-injection/source-poisoning tests

## Recommended MVP

Include foundation, project binding, knowledge core, repository bootstrap, hybrid retrieval, evidence, proposal workflow, MCP, and security/evaluation essentials.

Defer dedicated graph DB, full Jira automation, runtime ingestion, advanced graph UI, and autonomous publishing.
