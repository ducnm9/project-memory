# 11 — MVP Definition

## Objective

Prove one complete loop:

```text
Repository
   ↓
Bootstrap
   ↓
Project Memory
   ↓
MCP
   ↓
Agent asks
   ↓
Hybrid retrieval
   ↓
Evidence-backed answer
   ↓
Agent discovers new knowledge
   ↓
Proposal
   ↓
Human approval
   ↓
Published memory
```

## MVP scope

### Input
One Git repository, source code, configuration, and available docs.

### Knowledge
Project Overview, Architecture, Concept, Fact, Decision, Troubleshooting, Investigation.

### Retrieval
Project-scoped full-text + vector + metadata + reranking + evidence + related knowledge.

### Governance
Proposal, structural validation, duplicate detection, evidence validation, approval, versioning, audit, stale flag.

### MCP
```text
project.resolve
project.bootstrap
knowledge.search
knowledge.get
knowledge.ask
knowledge.related
knowledge.impact
knowledge.propose
knowledge.update
knowledge.deprecate
knowledge.feedback
```

## MVP demo

1. Connect a repository with little/no documentation.
2. Bootstrap analyzes code/config.
3. Generate project snapshot and knowledge proposals.
4. Reviewer publishes initial architecture knowledge.
5. Kiro/OpenCode connects through MCP.
6. Developer asks how authentication works.
7. Agent retrieves architecture and code evidence.
8. Developer asks why a dependency exists.
9. Agent retrieves related decision/relation/evidence.
10. Agent discovers a new constraint during implementation.
11. Agent proposes a Fact/Decision with source evidence.
12. Reviewer approves.
13. Another developer retrieves it later.

## Definition of Done

- new repository can be understood without pre-existing documentation;
- agent resolves the correct project;
- project-scoped retrieval works;
- answers contain evidence;
- knowledge can be proposed;
- duplicate/conflict checks execute before publication;
- humans can approve/reject;
- versions and audit are visible;
- unauthorized knowledge cannot be retrieved.

## Explicit non-goals

- fully autonomous publication of important decisions;
- perfect architectural inference;
- enterprise-wide graph database;
- replacing Jira/GitHub/document systems;
- storing all raw enterprise data indefinitely;
- building a generic chatbot first.

## North-star

> Project Memory should make the next developer or AI agent start from what the team already knows, rather than from zero.
