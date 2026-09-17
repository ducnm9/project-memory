# 08 — Security & Multi-tenancy

## Tenant model

```text
Organization
  ├── Shared Knowledge
  ├── Project A
  ├── Project B
  └── Project C
```

Every knowledge object should carry organization/project scope unless explicitly shared.

## Retrieval precedence

```text
Project-specific
      ↓
Organization-shared
      ↓
Global/shared
```

This is a relevance preference, never a permission bypass.

## Data boundary

For enterprise deployments:

- keep raw source data within approved cloud boundaries;
- enforce source permissions;
- return only authorized excerpts;
- support masking/redaction for sensitive content.

## Secrets

Never store credentials, access tokens, passwords, or private keys as knowledge.

Connector credentials belong in a secrets system.

## Isolation

Tenant/project filters must be enforced in the service/data layer, not only in client-side parameters.

## Threat model

Consider:

- cross-project retrieval leakage;
- prompt injection in source documents;
- malicious proposals;
- poisoned evidence;
- stale permissions;
- connector over-privilege;
- data exfiltration through answers.

Treat ingested source content as untrusted input.
