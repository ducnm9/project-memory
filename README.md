# Project Memory

> **Learn once. Record once. Retrieve everywhere.**

Project Memory is an Engineering Intelligence Platform that gives developers and AI agents a shared, evidence-backed memory of a software project.

It turns source code and engineering artifacts into reusable project knowledge: architecture, facts, decisions, procedures, investigations, troubleshooting knowledge, relationships, provenance, versions, and audit history.

## Core idea

```text
Code / Git / Jira / Docs
          ↓
       Ingest
          ↓
 Analyze / Extract
          ↓
 Knowledge Proposal
          ↓
      Validate
          ↓
       Publish
          ↓
 Developer / Agent
          ↓
 Search / Ask / Related / Impact
          ↓
 New discovery
          ↓
       Propose
          ↓
 Project Memory evolves
```

> **RAG is the search engine of Project Memory, not Project Memory itself.**

## Why

Engineering knowledge is scattered across code, pull requests, issues, architecture decisions, runbooks, and people's experience. Project Memory makes that knowledge reusable by both humans and AI agents.

## Core capabilities

- Project-aware knowledge retrieval
- Repository bootstrap without requiring README/ADR/AGENTS.md
- Facts, decisions, concepts, procedures, investigations, troubleshooting, architecture
- Explicit relationships
- Provenance and evidence
- Versioning and audit
- Duplicate and contradiction detection
- Freshness/staleness management
- Human-governed knowledge proposals
- MCP interface for AI agents
- Hybrid lexical + vector retrieval
- GitHub/Jira/document ingestion

## Architecture

```text
Developer / Agent
 Kiro | OpenCode | Claude Code | Cursor
                │
                ▼
              MCP
                │
                ▼
       Project Memory API
        ┌───────┼────────┐
        ▼       ▼        ▼
    Knowledge Search  Governance
      Core      Engine
        │       │
        └───┬───┘
            ▼
       Evidence Context
            │
            ▼
          Agent

Sources → Ingestion → Extraction → Proposal → Validation → Publish
GitHub | Git | Jira | Docs | S3 | Human | Agent
```

## Repository structure

- `docs/` — human-readable product and engineering documentation
- `specs/` — machine-readable contracts
- `examples/` — concrete knowledge and MCP examples
- `diagrams/` — architecture diagrams
- `evaluation/` — retrieval/answer/governance evaluation
- `scripts/` — validation and developer utilities
- `.github/` — issue/PR templates and CI

## Documentation

- [Product Vision](docs/01-product/product-vision.md)
- [System Architecture](docs/02-architecture/system-architecture.md)
- [Domain & Data Model](docs/03-domain/domain-model.md)
- [Bootstrap & Ingestion](docs/04-ingestion/bootstrap.md)
- [Retrieval](docs/05-retrieval/retrieval-overview.md)
- [MCP](docs/06-mcp/overview.md)
- [Governance](docs/07-governance/governance.md)
- [Security](docs/08-security/security.md)
- [Evaluation](docs/09-evaluation/evaluation.md)
- [MVP](docs/01-product/mvp.md)

## Status

🚧 Experimental / MVP design

## Development principle

The platform should itself use Project Memory. Architectural decisions, implementation discoveries, and important engineering knowledge should be recorded using the same model the platform provides to its users.
