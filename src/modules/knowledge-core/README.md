# Knowledge Core

Canonical knowledge items, facts, relations, versions, provenance, and audit.

**Status:** The `KnowledgeItem` model, lifecycle state machine, tenant-scoped
repository, and CRUD routes landed in PM-010. Facts (PM-014) are now a
first-class subject–predicate–object entity with their own collection,
CRUD/versioning/source routes. Relations (PM-015) are a first-class
subject–predicate–object graph edge with a fixed predicate vocabulary,
reviewer stamping on the accept/reject decision, and their own collection,
CRUD/versioning/source routes. Versioning (PM-012), provenance (PM-013),
and audit (PM-016) are tracked separately.
