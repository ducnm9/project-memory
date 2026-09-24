export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}

export class InvalidTenantScopeError extends AppError {
  constructor(message: string) {
    super(message, 400, "INVALID_TENANT_SCOPE");
  }
}

export class TenantNotFoundError extends AppError {
  constructor() {
    super("organization or project not found", 404, "TENANT_NOT_FOUND");
  }
}


export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenScopeError extends AppError {
  constructor(message: string) {
    super(message, 403, "FORBIDDEN_SCOPE");
  }
}

export class InvalidRepositoryUrlError extends AppError {
  constructor(message = "repository url is missing or malformed") {
    super(message, 400, "INVALID_REPOSITORY_URL");
  }
}

export class RepositoryConflictError extends AppError {
  constructor(message = "repository is already bound to a different project") {
    super(message, 409, "REPOSITORY_ALREADY_BOUND");
  }
}

export class RepositoryNotFoundError extends AppError {
  constructor(message = "repository binding not found") {
    super(message, 404, "REPOSITORY_NOT_FOUND");
  }
}

export class KnowledgeNotFoundError extends AppError {
  constructor(message = "knowledge item not found") {
    super(message, 404, "KNOWLEDGE_NOT_FOUND");
  }
}

export class SourceNotFoundError extends AppError {
  constructor(message = "source not found") {
    super(message, 404, "SOURCE_NOT_FOUND");
  }
}

export class EvidenceValidationError extends AppError {
  constructor(message = "evidence validation failed") {
    super(message, 422, "EVIDENCE_VALIDATION_ERROR");
  }
}

export class DuplicateProposalError extends AppError {
  constructor(message = "duplicate proposal detected") {
    super(message, 409, "DUPLICATE_PROPOSAL");
  }
}

export class FactNotFoundError extends AppError {
  constructor(message = "fact not found") {
    super(message, 404, "FACT_NOT_FOUND");
  }
}

export class RelationNotFoundError extends AppError {
  constructor(message = "relation not found") {
    super(message, 404, "RELATION_NOT_FOUND");
  }
}

export class InvalidKnowledgeTypeError extends AppError {
  constructor(message = "knowledge type is not supported") {
    super(message, 422, "INVALID_KNOWLEDGE_TYPE");
  }
}

export class InvalidStatusTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(`invalid status transition: ${from} -> ${to}`, 422, "INVALID_STATUS_TRANSITION");
  }
}

export class GapNotFoundError extends AppError {
  constructor(message = "knowledge gap not found") {
    super(message, 404, "GAP_NOT_FOUND");
  }
}

export class CredentialNotFoundError extends AppError {
  constructor(message = "connector credential not found") {
    super(message, 404, "CREDENTIAL_NOT_FOUND");
  }
}

export class GitCloneError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, "GIT_CLONE_FAILED");
    if (cause !== undefined) this.cause = cause;
  }
}

export class FileNotFoundError extends AppError {
  constructor(message = "file not found in repository") {
    super(message, 404, "FILE_NOT_FOUND");
  }
}
