import { NextResponse } from 'next/server'
import { requireSession, type GuardResult } from '@/app/lib/auth-guards'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { proposalsEnabled } from './constants'
import { loadPilotState, pilotAllows } from './pilot'

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

/** Enabled + signed in. During a pilot only the listed members get through (the rest see a 404, as if it did not exist). */
export async function requireProposalsSession(): Promise<GuardResult> {
  const off = await requireEnabled()
  if (off) return { ok: false, response: off }
  const auth = await requireSession()
  if (!auth.ok) return { ok: false, response: out({ error: 'Not authenticated' }, 401) }
  if (!pilotAllows(await loadPilotState(), auth.session.discordId)) return { ok: false, response: out({ error: 'Not found' }, 404) }
  return auth
}

/**
 * For routes that need no session of their own (the public voting key): while a pilot runs, only a signed-in tester
 * gets through (404 for everyone else). Outside a pilot it lets everyone through.
 */
export async function requirePilotAccess(): Promise<NextResponse | null> {
  const state = await loadPilotState()
  if (!state.running) return null
  const auth = await requireSession()
  if (!auth.ok || !pilotAllows(state, auth.session.discordId)) return out({ error: 'Not found' }, 404)
  return null
}

export type RouteCtx = { params: Promise<{ id: string }> }
