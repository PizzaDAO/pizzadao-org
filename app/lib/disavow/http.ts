import { NextResponse } from 'next/server'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

/** Every disavow response is `private, no-store`. */
export function out(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS })
}

/** Catch-all: never echoes details, never logs statements (name only). */
export function safe<A extends unknown[]>(label: string, fn: (...args: A) => Promise<NextResponse>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await fn(...args)
    } catch (e) {
      console.error(`[disavow] ${label} failed:`, (e as Error)?.name)
      return out({ error: 'Something went wrong' }, 500)
    }
  }
}

type Ctx = { params: Promise<{ id: string }> }
export type { Ctx }
