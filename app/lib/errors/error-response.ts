import { NextResponse } from 'next/server';
import { ApiError } from './api-errors';

export interface ErrorResponse {
  error: string;
  code?: string;
}

/**
 * Convert an error to a standardized NextResponse
 */
export function handleApiError(error: unknown): NextResponse<ErrorResponse> {
  // Handle known ApiError types
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.statusCode }
    );
  }

  console.error('[api] unhandled error:', error);

  // Generic Error instances. Some lib functions (e.g. shop) still throw plain
  // Errors with user-facing messages, so those pass through, but database
  // errors can contain query/schema details and are never echoed.
  if (error instanceof Error && !error.name.startsWith('Prisma')) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  // Handle unknown error types
  return NextResponse.json(
    { error: 'An unexpected error occurred' },
    { status: 500 }
  );
}

/**
 * Log an unexpected error server-side and return a generic JSON error.
 * Use this instead of echoing `e.message` (which can leak Discord / Google /
 * database internals) to the client.
 */
export function internalError(
  error: unknown,
  context: string,
  message = 'Internal server error',
  status = 500,
  headers?: HeadersInit
): NextResponse<ErrorResponse> {
  console.error(`[${context}]`, error);
  return NextResponse.json({ error: message }, { status, headers });
}

/**
 * Like internalError, but passes the error message through when it is one of
 * an explicit allowlist of user-facing strings (messages the client displays).
 * Anything else is logged server-side and replaced with a generic message.
 */
export function safeMessageError(
  error: unknown,
  context: string,
  safeMessages: readonly string[],
  status = 400,
  headers?: HeadersInit
): NextResponse<ErrorResponse> {
  if (error instanceof Error && safeMessages.includes(error.message)) {
    return NextResponse.json({ error: error.message }, { status, headers });
  }
  return internalError(error, context, 'Internal server error', 500, headers);
}

/**
 * Wrap route handlers with consistent error handling
 *
 * Usage:
 * export const POST = withErrorHandling(async (req: Request) => {
 *   // throw ApiError types instead of returning error responses
 * });
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T
): T {
  return (async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleApiError(error);
    }
  }) as T;
}
