# AWS Reference Architecture

The supplied Kiro/AWS reference demonstrates:

```text
Kiro → MCP → Bedrock Knowledge Base → OpenSearch
                                  ↑
                                  S3
```

Project Memory keeps this useful infrastructure pattern but adds a semantic Knowledge Core, governance and living ingestion:

```text
Agents → MCP → Project Memory API
                  ├─ Knowledge Core
                  ├─ Retrieval
                  ├─ Governance
                  └─ Ingestion

GitHub / Git / Jira / Docs / S3
              ↓
       Extraction / Analysis
              ↓
          Proposals
```

AWS services are infrastructure choices, not domain-model dependencies.
