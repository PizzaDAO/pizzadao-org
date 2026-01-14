/**
 * Base class for all API errors with HTTP status codes
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * 400 - Bad Request (validation, invalid input)
 */
export class ValidationError extends ApiError {
  constructor(message: string, public readonly field?: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

/**
 * 401 - Not Authenticated (no valid session)
 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'Not authenticated') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/**
 * 403 - Forbidden (authenticated but insufficient permissions)
 */
export class ForbiddenError extends ApiError {
  constructor(message: string) {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * 404 - Not Found
 */
export class NotFoundError extends ApiError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

/**
 * 409 - Conflict (resource already exists, state conflict)
 */
export class ConflictError extends ApiError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * 502 - Bad Gateway (external service failure)
 */
export class ExternalServiceError extends ApiError {
  constructor(service: string, details?: string) {
    const message = details ? `${service} service error: ${details}` : `${service} service error`;
    super(message, 502, 'EXTERNAL_SERVICE_ERROR');
  }
}
