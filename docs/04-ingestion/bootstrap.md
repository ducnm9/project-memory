# 04 — Repository Bootstrap & Ingestion

## Principle

No README, Markdown, ADR, or AGENTS.md is required. A Git repository is sufficient to bootstrap an initial project model.

## Bootstrap flow

```text
Connect repository
      ↓
Repository discovery
      ↓
Code / config analysis
      ↓
Project snapshot
      ↓
Generated knowledge proposals
      ↓
Validation / approval
      ↓
Initial Project Memory
```

## Discovery

Analyze:

- languages;
- frameworks;
- package managers;
- build/test systems;
- database/ORM;
- API styles;
- entry points;
- modules;
- dependencies;
- CI/CD;
- infrastructure;
- integrations;
- configuration patterns.

## Generated knowledge

Bootstrap can propose:

- project overview;
- architecture components;
- module responsibilities;
- dependency relationships;
- important configuration;
- testing approach;
- API surface;
- infrastructure facts.

Generated knowledge is proposed by default, not automatically canonical.

## Incremental ingestion

```text
commit / PR / issue / document change
        ↓
change detection
        ↓
incremental extraction
        ↓
candidate knowledge
        ↓
duplicate/conflict checks
        ↓
proposal
```

## GitHub ingestion

Useful events:

- repository connected;
- push/commit;
- PR opened/updated/merged;
- issue created/updated.

PRs are valuable because they contain intent and decision context that raw code may not expose.

## Search-before-write

Every create/update proposal should:

1. find similar knowledge;
2. detect duplicates;
3. detect contradictions;
4. find related knowledge;
5. validate evidence;
6. create a proposal;
7. require approval according to policy.

## AGENTS.md

AGENTS.md is an optional projection of Project Memory. Keep it concise: critical rules, architecture constraints, testing commands, important decisions, and MCP pointer. It is not the knowledge database.
