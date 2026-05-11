export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      code?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.statusCode = options?.statusCode ?? 500;
    this.code = options?.code ?? "INTERNAL_ERROR";
    this.details = options?.details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      details,
    });
  }
}

export class AuthError extends AppError {
  constructor(message = "Authentication required") {
    super(message, {
      statusCode: 401,
      code: "AUTH_REQUIRED",
    });
  }
}

export class PermissionError extends AppError {
  constructor(message = "Insufficient permissions") {
    super(message, {
      statusCode: 403,
      code: "FORBIDDEN",
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, {
      statusCode: 409,
      code: "CONFLICT",
    });
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, {
      statusCode: 502,
      code: "EXTERNAL_SERVICE_ERROR",
      details,
    });
  }
}
