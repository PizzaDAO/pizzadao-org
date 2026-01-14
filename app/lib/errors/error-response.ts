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

  // Handle generic Error instances
  if (error instanceof Error) {
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
