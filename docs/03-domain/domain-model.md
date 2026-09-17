# 03 — Domain & Data Model

## Core entities

```text
Organization
  └── Project
       ├── KnowledgeItem
       ├── Fact
       ├── Relation
       ├── Source
       ├── Version
       ├── Proposal
       ├── AuditEvent
       └── KnowledgeGap
```

## Knowledge types

- Decision
- Concept
- Procedure
- Troubleshooting
- Investigation
- Architecture
- Fact

### Decision contract

context, problem, decision, alternatives, consequences, evidence.

### Concept contract

definition, responsibility, boundaries, related concepts, evidence.

### Procedure contract

purpose, prerequisites, steps, verification, failure handling.

### Troubleshooting contract

symptoms, diagnosis, cause, resolution, verification, evidence.

### Investigation contract

question, observations, hypotheses, findings, conclusion, evidence.

### Architecture contract

component, responsibility, dependencies, interfaces, constraints, evidence.

## KnowledgeItem

```json
{
  "id": "uuid",
  "organizationId": "org-1",
  "projectId": "project-1",
  "type": "Decision",
  "title": "Use AuditLog v2 for Matter History",
  "summary": "Matter History uses the standardized audit schema.",
  "content": {},
  "status": "PUBLISHED",
  "version": 3,
  "ownerId": "user-1",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "lastVerifiedAt": "timestamp"
}
```

## Facts

```json
{
  "subjectId": "matter-history",
  "predicate": "depends_on",
  "objectId": "audit-log",
  "status": "ACCEPTED",
  "sourceIds": ["pr-1821"]
}
```

## Relations

Initial predicates:

- depends_on
- implemented_by
- defined_by
- related_to
- supersedes
- contradicts
- derived_from
- documents
- fixes
- impacts
- owned_by

Canonical relations carry source, status, creator, timestamps, and optional reviewer.

## Provenance

Sources can be:

- repository file;
- Git commit;
- GitHub PR/issue;
- Jira issue;
- document;
- human input;
- agent proposal;
- runtime observation.

Important claims should expose origin, creator, approver, verification time, supporting sources, and previous version.

## Lifecycle

```text
DISCOVERED → PROPOSED → VALIDATING
                         ↙      ↘
                    REJECTED   ACCEPTED → PUBLISHED
                                           ↙ ↓ ↘
                                      UPDATED STALE DEPRECATED
```

## Knowledge Gap

Capture repeated unanswered project questions:

- question;
- project;
- occurrence count;
- first/last seen;
- attempted searches;
- related knowledge;
- owner;
- resolution status.

## Canonical vs search representation

The canonical semantic record is the source of truth. Search text, chunks, and embeddings are derived representations and can be regenerated.
