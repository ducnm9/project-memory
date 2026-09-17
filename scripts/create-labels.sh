#!/bin/zsh
REPO="ducnm9/project-memory"

echo "Creating epic labels..."
gh label create "epic:knowledge-core" --color "e4e669" --description "Epic 2 - Knowledge Core" --repo $REPO
gh label create "epic:bootstrap" --color "d93f0b" --description "Epic 3 - Bootstrap" --repo $REPO
gh label create "epic:retrieval" --color "0e8a16" --description "Epic 4 - Retrieval" --repo $REPO
gh label create "epic:governance" --color "b60205" --description "Epic 5 - Governance" --repo $REPO
gh label create "epic:mcp" --color "1d76db" --description "Epic 6 - MCP" --repo $REPO
gh label create "epic:integrations" --color "5319e7" --description "Epic 7 - GitHub/Jira Integrations" --repo $REPO
gh label create "epic:console" --color "f9d0c4" --description "Epic 8 - Console UI" --repo $REPO
gh label create "epic:agents" --color "c2e0c6" --description "Epic 9 - AGENTS Projection" --repo $REPO
gh label create "epic:quality" --color "bfd4f2" --description "Epic 10 - Quality and Operations" --repo $REPO

echo "Creating milestone labels..."
gh label create "milestone:M0" --color "ededed" --description "M0 - Foundation" --repo $REPO
gh label create "milestone:M1" --color "ededed" --description "M1 - Repository Memory" --repo $REPO
gh label create "milestone:M2" --color "ededed" --description "M2 - Agent Retrieval" --repo $REPO
gh label create "milestone:M3" --color "ededed" --description "M3 - Knowledge Contribution" --repo $REPO
gh label create "milestone:M4" --color "ededed" --description "M4 - Engineering Integrations" --repo $REPO
gh label create "milestone:M5" --color "ededed" --description "M5 - Enterprise" --repo $REPO

echo "Done!"
