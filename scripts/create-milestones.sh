#!/bin/zsh
REPO="ducnm9/project-memory"

echo "Creating milestones..."
gh api repos/$REPO/milestones -f title="M0 - Foundation" -f description="Backend service, database, tenancy, authentication, and repository binding." -f state="open"
gh api repos/$REPO/milestones -f title="M1 - Repository Memory" -f description="Git connector, repository analyzer, project snapshot, and initial knowledge proposals from repository source." -f state="open"
gh api repos/$REPO/milestones -f title="M2 - Agent Retrieval" -f description="Embedding pipeline, hybrid retrieval (full-text + vector + metadata), reranking, evidence-aware context assembly, and MCP read tools." -f state="open"
gh api repos/$REPO/milestones -f title="M3 - Knowledge Contribution" -f description="Proposal workflow, structural validation, duplicate/contradiction detection, human review and approval, versioning, and immutable audit log." -f state="open"
gh api repos/$REPO/milestones -f title="M4 - Engineering Integrations" -f description="GitHub App/OAuth, webhooks, PR/commit/issue ingestion, Jira connector, and incremental knowledge extraction from engineering systems." -f state="open"
gh api repos/$REPO/milestones -f title="M5 - Enterprise" -f description="Security hardening, observability/tracing, retrieval evaluation benchmark, console UI, AGENTS.md projection, and operational controls." -f state="open"

echo "Done!"
