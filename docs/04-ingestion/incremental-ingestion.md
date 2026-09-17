# Incremental Ingestion

Project Memory is a living system.

```text
Commit / PR / Issue / Document change
          ↓
      Change detection
          ↓
  Identify affected entities
          ↓
 Incremental extraction
          ↓
 Candidate knowledge
          ↓
 Duplicate/conflict checks
          ↓
       Proposal
```

Avoid rebuilding the entire knowledge base for every small change.
