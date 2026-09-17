# Contributing

## Before changing the design

Read:

1. `README.md`
2. `docs/02-architecture/system-architecture.md`
3. Relevant domain/spec documents
4. Existing ADRs

## Architecture changes

Architecture-impacting changes should include an ADR under:

`docs/02-architecture/architecture-decisions/`

## Knowledge model changes

Changes to knowledge types or lifecycle should update:

- `docs/03-domain/`
- `specs/knowledge/`
- relevant examples
- tests/evaluation where applicable

## MCP changes

Update both:

- conceptual documentation in `docs/06-mcp/`
- machine-readable contracts in `specs/mcp/`

## Pull requests

A PR should explain:

- problem;
- proposed change;
- alternatives considered;
- impact;
- tests/evaluation;
- documentation updates.

Keep changes focused and preserve backwards compatibility where practical.
