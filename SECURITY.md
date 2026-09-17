# Security

Please do not report security vulnerabilities through public GitHub issues.

For an internal deployment, replace this file with the organization's approved security reporting process.

## Security principles

- enforce organization/project isolation server-side;
- never trust project IDs supplied only by an agent;
- treat ingested source content as untrusted input;
- do not store credentials as knowledge;
- enforce source permissions before retrieval;
- audit privileged changes;
- protect connector credentials with a secrets manager;
- test against prompt injection and source poisoning.
