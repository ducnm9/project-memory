# ADR-002: MCP Is the Agent Interface

## Status
Accepted

## Decision
AI agents access Project Memory through MCP rather than depending directly on storage or search infrastructure.

## Consequences
MongoDB, OpenSearch, Bedrock and other infrastructure can evolve behind the interface.
