import { NextResponse } from 'next/server'
import { requireSession, type GuardResult } from '@/app/lib/auth-guards'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { proposalsEnabled } from './constants'

/** Every proposals response is `private, no-store`. */
export function out(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS })
}

/**
 * Catch-all: logs the error NAME only. Never the message or body, because a vote request carries a
 * ballot token and a choice and neither may reach a log.
 */
export function safe<A extends unknown[]>(label: string, fn: (...args: A) => Promise<NextResponse>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await fn(...args)
    } catch (e) {
      console.error(`[proposals] ${label} failed:`, (e as Error)?.name)
      return out({ error: 'Something went wrong' }, 500)
    }
  }
}

/** 404 (as if the feature did not exist) while it is off. */
export async function requireEnabled(): Promise<NextResponse | null> {
  return (await proposalsEnabled()) ? null : out({ error: 'Not found' }, 404)
}

/** Enabled + signed in. */
export async function requireProposalsSession(): Promise<GuardResult> {
  const off = await requireEnabled()
  if (off) return { ok: false, response: off }
  const auth = await requireSession()
  if (!auth.ok) return { ok: false, response: out({ error: 'Not authenticated' }, 401) }
  return auth
}

export type RouteCtx = { params: Promise<{ id: string }> }
