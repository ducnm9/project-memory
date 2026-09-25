// Re-export governance proposal types for backward compat
export type { ProposalStatus, Proposal as KnowledgeProposal } from "../governance/proposal-entities.js";
export { PROPOSAL_STATUSES, newProposalId } from "../governance/proposal-entities.js";
