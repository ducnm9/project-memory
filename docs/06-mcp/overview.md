# 06 — MCP & API Contract

## Principle

MCP is the stable agent-facing interface. Agents should not depend on storage technology.

## Project tools

- `project.resolve`
- `project.bootstrap`

## Read tools

- `knowledge.search`
- `knowledge.get`
- `knowledge.ask`
- `knowledge.related`
- `knowledge.impact`

## Write/proposal tools

- `knowledge.propose`
- `knowledge.update`
- `knowledge.deprecate`
- `knowledge.feedback`
- `knowledge.record_decision`
- `knowledge.record_fact`
- `knowledge.record_investigation`

## Example search

```json
{
  "query": "due date PATCH orderId Draft",
  "types": ["Troubleshooting", "Decision"],
  "status": ["PUBLISHED"],
  "limit": 10
}
```

## Agent policy

Default:

```text
READ → UNDERSTAND → CODE → DISCOVER → PROPOSE
```

Avoid silent canonical overwrites.

## Project identity

Prefer trusted identity signals:

- authenticated identity;
- connected repository;
- organization/project mapping.

Do not rely solely on an arbitrary project ID supplied by an agent.

## Authorization

Evaluate organization, project, actor, role, visibility, and source permissions for every operation.

## Audit

Write operations should record actor, operation, target, timestamp, reason, source, previous version, and new version.
