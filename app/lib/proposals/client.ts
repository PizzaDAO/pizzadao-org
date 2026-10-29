'use client'

/**
 * Browser side of secret voting. The ballot (token + blind signature) lives in this browser, per proposal.
 *
 *  - prepareBallot(): runs when the member is on the site (NOT when they vote): checks the proposal's public key
 *    (fingerprint pinned, modulus >= 2048), blinds a fresh token, asks the server to sign it (once per member),
 *    unblinds, keeps it in localStorage;
 *  - submitVote(): a vote made while the token is young is queued and sent later (see queue.ts), so the token request
 *    and the vote request are far apart in time;
 *  - castVote(): sends token + choice with no cookies and no referrer to the unauthenticated vote endpoint;
 *  - the "vote code" is the ballot encoded as text, to change a vote from another browser.
 */
import { blind, finalize, fromBase64, importPublicKey, prepareMessage, toBase64 } from '@/utils/blindRsa.client'
import { fingerprintOfPem, modulusOk } from './fingerprint'
import { planVoteSend } from './queue'

export type Choice = 'AYE' | 'NAY' | 'ABSTAIN'

export interface Ballot {
  token: string
  preparedMessage: string
  signature: string
  /** What this browser last sent (display only). */
  choice?: Choice
  /** When the token was made here (ms). Absent for a ballot restored from a code or backup, which is already old. */
  preparedAt?: number
  /** A vote waiting for its send time. */
  queued?: { choice: Choice; sendAt: number }
}

const PREFIX = 'pizzadao:proposal-ballot:'
const storageKey = (proposalId: string) => `${PREFIX}${proposalId}`
const pinKey = (proposalId: string) => `pizzadao:proposal-key:${proposalId}`

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

/** Fetch the proposal's key and check it: same fingerprint as the page showed, never changed since first seen, RSA >= 2048. */
async function trustedPublicKey(proposalId: string, pageFingerprint?: string | null): Promise<string> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/pubkey`, { cache: 'no-store' })
  if (!res.ok) throw new Error('key')
  const { publicKey, fingerprint } = (await res.json()) as { publicKey: string; fingerprint: string }
  const computed = await fingerprintOfPem(publicKey)
  if (computed !== fingerprint) throw new Error('key fingerprint mismatch')
  if (pageFingerprint && pageFingerprint !== computed) throw new Error('key differs from the proposal page')
  if (!(await modulusOk(publicKey))) throw new Error('key too small')
  try {
    const pinned = localStorage.getItem(pinKey(proposalId))
    if (pinned && pinned !== computed) throw new Error('key changed')
    if (!pinned) localStorage.setItem(pinKey(proposalId), computed)
  } catch (e) {
    if (e instanceof Error && e.message === 'key changed') throw e
  }
  return publicKey
}

const inFlight = new Map<string, Promise<Ballot | null>>()

/**
 * Make sure this browser has a ballot for the proposal. Resolves with it, or null when none can be made here
 * (not eligible, or the token was already issued to this member and this browser does not have it).
 * Concurrent callers (list + detail, or a React double effect) share one request.
 */
export function prepareBallot(proposalId: string, pageFingerprint?: string | null): Promise<Ballot | null> {
  const have = loadBallot(proposalId)
  if (have) return Promise.resolve(have)
  let p = inFlight.get(proposalId)
  if (!p) {
    p = (async () => {
      const pem = await trustedPublicKey(proposalId, pageFingerprint)
      const publicKey = await importPublicKey(pem)
      const token = `proposal-${proposalId}-${crypto.randomUUID()}`
      const prepared = prepareMessage(token)
      const { blindedMessage, blindInverse } = await blind(publicKey, prepared)
      const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blindedMessage: toBase64(blindedMessage) }),
      })
      if (res.status === 409 || res.status === 403 || res.status === 404) return loadBallot(proposalId) // issued elsewhere / not eligible / closed
      if (!res.ok) throw new Error('sign')
      const { blindSignature } = (await res.json()) as { blindSignature: string }
      const signature = await finalize(publicKey, prepared, fromBase64(blindSignature), blindInverse)
      const ballot: Ballot = { token, preparedMessage: toBase64(prepared), signature: toBase64(signature), preparedAt: Date.now() }
      saveBallot(proposalId, ballot)
      return ballot
    })().finally(() => inFlight.delete(proposalId))
    inFlight.set(proposalId, p)
  }
  return p
}

export type VoteOutcome = 'ok' | 'closed' | 'invalid' | 'error'

/** Sends the vote with no cookies and no referrer: the request carries nothing but the token and the choice. */
export async function castVote(proposalId: string, ballot: Ballot, choice: Choice): Promise<VoteOutcome> {
  try {
    const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/vote`, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ballot.token, preparedMessage: ballot.preparedMessage, signature: ballot.signature, choice }),
    })
    if (res.ok) return 'ok'
    if (res.status === 409 || res.status === 404) return 'closed'
    if (res.status === 401 || res.status === 400) return 'invalid'
    return 'error'
  } catch {
    return 'error'
  }
}

export type SubmitOutcome = VoteOutcome | 'queued'

/** Send the vote now if the token is old enough, otherwise queue it and send it later (here, or on a later visit). */
export async function submitVote(proposalId: string, ballot: Ballot, choice: Choice, closesAt: string | null, now = Date.now()): Promise<{ outcome: SubmitOutcome; ballot: Ballot }> {
  // A token without preparedAt came from a code or backup: it is already old.
  const plan = planVoteSend({ now, preparedAt: ballot.preparedAt ?? 0, closesAt: closesAt ? new Date(closesAt).getTime() : null, rand: Math.random() })
  if (!plan.immediate) {
    const next = { ...ballot, queued: { choice, sendAt: plan.sendAt } }
    saveBallot(proposalId, next)
    return { outcome: 'queued', ballot: next }
  }
  const outcome = await castVote(proposalId, ballot, choice)
  if (outcome !== 'ok') return { outcome, ballot }
  const next: Ballot = { ...ballot, choice }
  delete next.queued
  saveBallot(proposalId, next)
  return { outcome, ballot: next }
}

/** Send any queued vote whose time has come. Called on load and every minute by the site-wide component. */
export async function flushQueuedVotes(now = Date.now()): Promise<string[]> {
  const sent: string[] = []
  let keys: string[] = []
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
  } catch {
    return sent
  }
  for (const k of keys) {
    const id = k.slice(PREFIX.length)
    const b = loadBallot(id)
    if (!b?.queued || b.queued.sendAt > now) continue
    const outcome = await castVote(id, b, b.queued.choice)
    if (outcome === 'ok') {
      const next: Ballot = { ...b, choice: b.queued.choice }
      delete next.queued
      saveBallot(id, next)
      sent.push(id)
    } else if (outcome === 'closed' || outcome === 'invalid') {
      const next: Ballot = { ...b }
      delete next.queued
      saveBallot(id, next)
    }
  }
  return sent
}

/** Share (where the browser supports it) or copy the vote code. Returns how it was handled. */
export async function shareVoteCode(ballot: Ballot, title: string): Promise<'shared' | 'copied' | 'failed'> {
  const code = encodeVoteCode(ballot)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title, text: code })
      return 'shared'
    }
  } catch {
    /* cancelled: fall through to copy */
  }
  try {
    await navigator.clipboard.writeText(code)
    return 'copied'
  } catch {
    return 'failed'
  }
}
