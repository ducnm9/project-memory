# 01 — Product Vision

## Problem

Engineering knowledge is distributed across source code, Git history, pull requests, Jira, documents, runbooks, architecture decisions, and individual developers' experience.

Without a shared memory:

- developers repeatedly rediscover the same facts;
- AI agents lack project-specific context;
- architectural decisions become difficult to recover;
- troubleshooting knowledge disappears after an incident;
- documents become stale without clear ownership or evidence;
- teams cannot reliably answer why a system behaves a certain way.

## Product

Project Memory Cloud is an enterprise knowledge layer for software projects.

It provides:

- project-aware knowledge retrieval;
- structured facts, decisions, concepts, procedures, and investigations;
- explicit relationships between knowledge items;
- provenance and evidence;
- versioning and audit history;
- freshness and lifecycle management;
- agent access through MCP;
- ingestion from code and engineering systems.

## What it is not

It is not merely a vector database, document manager, chatbot, AGENTS.md generator, or graph database. RAG/vector search is one retrieval capability inside the platform.

## Product loop

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
Developer / Agent retrieves
        ↓
Developer / Agent discovers something new
        ↓
Propose / update / evidence
        ↓
Validate
        ↓
Project Memory evolves
```

## Core values

### Understand
"Help me understand this project."

### Remember
"Do not make me or the agent rediscover what the team already knows."

### Govern
"Every important piece of knowledge should have evidence, lifecycle, ownership, and history."

## Primary users

### Developer
Onboarding, architecture discovery, bug investigation, prior decisions, and impact analysis.

### AI Agent
Resolve project, retrieve context, explain code, reuse investigations, and propose new knowledge.

### Tech Lead / Architect
Review decisions, detect stale/conflicting knowledge, inspect project evolution, and identify knowledge gaps.

### Platform/Admin
Manage projects, permissions, connectors, audit, and operational health.

## Product principles

1. No Markdown prerequisite.
2. Repository itself is a valid source of project knowledge.
3. Knowledge is richer than documents.
4. Search before create/update.
5. Agents default to propose, not silently overwrite canonical knowledge.
6. Evidence is first-class.
7. Project-specific context takes precedence over shared context.
8. Knowledge is versioned and auditable.
9. Freshness matters.
10. MCP is the agent interface; backend implementation remains replaceable.
