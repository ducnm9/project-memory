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