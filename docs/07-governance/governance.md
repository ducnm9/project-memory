# 07 — Governance, Validation & Audit

## Goal

Prevent unsupported, duplicated, contradictory, stale, or unauthorized knowledge from becoming trusted project memory.

## Validation

### Structural
Validate each knowledge type against its contract.

### Duplicate
Check exact/near duplicates, semantic similarity, subject/type, and source overlap.

### Contradiction
Compare proposals with published knowledge and flag conflicting claims. Do not silently choose one.

### Evidence
Verify required supporting sources.

### Freshness
Mark knowledge stale when referenced code/source changes or verification expires.

### Relations
Ensure relation endpoints exist and lifecycle/permission rules are respected.

## Proposal workflow

```text
Agent / Developer
      ↓
PROPOSED
      ↓
Validation
      ↓
Reviewer
   ├── Approve
   ├── Edit
   └── Reject
```

## Immutable audit events

- CREATE
- UPDATE
- DEPRECATE
- RELATION_CREATE
- RELATION_UPDATE
- RELATION_DELETE
- APPROVE
- REJECT
- VERIFY
- MARK_STALE

## Trust signals

Expose explainable signals rather than an opaque quality score:

- status;
- sources;
- source authority;
- last verified;
- age;
- conflict state;
- reviewer;
- version.

## Responsibility

### Agent
Search, propose, attach evidence, suggest relations, report stale/conflict.

### Human
Approve, edit, reject, deprecate, resolve conflicts.

### Automation
Re-embed, synchronize sources, detect changes, validate structure, detect possible duplicates/conflicts, update freshness.
