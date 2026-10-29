'use client'

/**
 * Browser side of secret voting. The ballot (token + blind signature) lives in this browser, per proposal.
 *
 *  - prepareBallot(): runs when a proposal is shown (NOT when the member votes): blind a fresh token, ask the
 *    server to sign it (once per member), unblind, keep it in localStorage;
 *  - castVote(): later, sends token + choice to the unauthenticated vote endpoint;
 *  - the "vote code" is the ballot encoded as text, to change a vote from another browser.
 */
import { blind, finalize, fromBase64, importPublicKey, prepareMessage, toBase64 } from '@/utils/blindRsa.client'

export type Choice = 'AYE' | 'NAY' | 'ABSTAIN'

export interface Ballot {
  token: string
  preparedMessage: string
  signature: string
  /** What this browser last sent (display only). */
  choice?: Choice
}

const storageKey = (proposalId: string) => `pizzadao:proposal-ballot:${proposalId}`

export function loadBallot(proposalId: string): Ballot | null {
  try {
    const raw = localStorage.getItem(storageKey(proposalId))
    if (!raw) return null
    const b = JSON.parse(raw) as Ballot
    return typeof b.token === 'string' && typeof b.preparedMessage === 'string' && typeof b.signature === 'string' ? b : null
  } catch {
    return null
  }
}

export function saveBallot(proposalId: string, ballot: Ballot): void {
  try {
    localStorage.setItem(storageKey(proposalId), JSON.stringify(ballot))
  } catch {
    /* private window or blocked storage: the vote code still works */
  }
}

/** The ballot as a copyable string. base64url of {t, p, s}. */
export function encodeVoteCode(b: Ballot): string {
  const json = JSON.stringify({ t: b.token, p: b.preparedMessage, s: b.signature })
  return toBase64(new TextEncoder().encode(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeVoteCode(code: string, proposalId: string): Ballot | null {
  try {
    const clean = code.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
    const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4)
    const o = JSON.parse(new TextDecoder().decode(fromBase64(padded))) as { t?: unknown; p?: unknown; s?: unknown }
    if (typeof o.t !== 'string' || typeof o.p !== 'string' || typeof o.s !== 'string') return null
    if (!o.t.startsWith(`proposal-${proposalId}-`)) return null
    return { token: o.t, preparedMessage: o.p, signature: o.s }
  } catch {
    return null
  }
}

const inFlight = new Map<string, Promise<Ballot | null>>()

/**
 * Make sure this browser has a ballot for the proposal. Resolves with it, or null when none can be made here
 * (not eligible, or the token was already issued to this member and this browser does not have it).
 * Concurrent callers (list + detail, or a React double effect) share one request.
 */
export function prepareBallot(proposalId: string): Promise<Ballot | null> {
  const have = loadBallot(proposalId)
  if (have) return Promise.resolve(have)
  let p = inFlight.get(proposalId)
  if (!p) {
    p = (async () => {
      const keyRes = await fetch('/api/proposals/pubkey', { cache: 'no-store' })
      if (!keyRes.ok) throw new Error('key')
      const { publicKey: pem } = (await keyRes.json()) as { publicKey: string }
      const publicKey = await importPublicKey(pem)
      const token = `proposal-${proposalId}-${crypto.randomUUID()}`
      const prepared = prepareMessage(token)
      const { blindedMessage, blindInverse } = await blind(publicKey, prepared)
      const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blindedMessage: toBase64(blindedMessage) }),
      })
      if (res.status === 409 || res.status === 403) return loadBallot(proposalId) // issued elsewhere / not eligible
      if (!res.ok) throw new Error('sign')
      const { blindSignature } = (await res.json()) as { blindSignature: string }
      const signature = await finalize(publicKey, prepared, fromBase64(blindSignature), blindInverse)
      const ballot: Ballot = { token, preparedMessage: toBase64(prepared), signature: toBase64(signature) }
      saveBallot(proposalId, ballot)
      return ballot
    })().finally(() => inFlight.delete(proposalId))
    inFlight.set(proposalId, p)
  }
  return p
}

export type VoteOutcome = 'ok' | 'closed' | 'invalid' | 'error'

export async function castVote(proposalId: string, ballot: Ballot, choice: Choice): Promise<VoteOutcome> {
  try {
    const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ballot.token, preparedMessage: ballot.preparedMessage, signature: ballot.signature, choice }),
    })
    if (res.ok) {
      saveBallot(proposalId, { ...ballot, choice })
      return 'ok'
    }
    if (res.status === 409) return 'closed'
    if (res.status === 401 || res.status === 400) return 'invalid'
    return 'error'
  } catch {
    return 'error'
  }
}
