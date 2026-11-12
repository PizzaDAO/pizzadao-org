'use client'

/**
 * Browser side of secret voting. The ballot (token + blind signature) lives in this browser, per proposal.
 *
 *  - prepareBallot(): runs when the member is on the site (NOT when they vote): checks the proposal's public key
 *    (fingerprint checked against the page and, when the member came from the Discord post, the fingerprint in its link;
 *    pinned after first sight; modulus >= 2048), blinds a fresh token, asks the server to sign it (once per member),
 *    unblinds, keeps it in localStorage;
 *  - submitVote(): sends the vote at once; the server mixes votes before they reach the ballot table (pending.ts);
 *  - castVote(): sends token + choice with no cookies and no referrer to the unauthenticated vote endpoint;
 *  - the "vote code" is the ballot encoded as text, to vote or change a vote from another browser.
 */
import { blind, finalize, fromBase64, importPublicKey, prepareMessage, toBase64 } from '@/utils/blindRsa.client'
import { fingerprintOfPem, modulusOk } from './fingerprint'

export type Choice = 'AYE' | 'NAY' | 'ABSTAIN'

export interface Ballot {
  token: string
  preparedMessage: string
  signature: string
  /** What this browser last sent (display only). */
  choice?: Choice
  /** When the token was made here (ms). */
  preparedAt?: number
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

const LEGACY_UNSAVED_KEY = 'pizzadao:proposals-unsaved'

/** Proposal ids that have a ballot stored in this browser. */
export function listBallotIds(): string[] {
  const ids: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) ids.push(k.slice(PREFIX.length))
    }
  } catch {
    /* no storage */
  }
  return ids
}

/** Forget this browser's ballot and pinned key for a proposal (used once the proposal is no longer open). */
export function removeBallot(proposalId: string): void {
  try {
    localStorage.removeItem(storageKey(proposalId))
    localStorage.removeItem(pinKey(proposalId))
  } catch {
    /* no storage */
  }
}

/** Drops the old "save your code" reminder list that earlier versions kept. */
export function clearLegacyUnsaved(): void {
  try {
    localStorage.removeItem(LEGACY_UNSAVED_KEY)
  } catch {
    /* no storage */
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

const CLOCK_KEY = 'pizzadao:proposals-clock'
let clockOffsetMs = 0
let clockLoaded = false

function loadClock(): void {
  if (clockLoaded) return
  clockLoaded = true
  for (const store of ['sessionStorage', 'localStorage'] as const) {
    try {
      const o = JSON.parse(window[store].getItem(CLOCK_KEY) || 'null') as { offset?: number; at?: number } | null
      if (o && Number.isFinite(o.offset) && Number.isFinite(o.at) && Date.now() - (o.at as number) < 30 * 24 * 3600 * 1000) {
        clockOffsetMs = o.offset as number
        return
      }
    } catch {
      /* try the next store */
    }
  }
}

/** Learn how far this device's clock is from the server's, from a response's Date header (1 s resolution). */
export function noteServerDate(res: { headers?: { get(name: string): string | null } } | null | undefined): void {
  try {
    const d = Date.parse(res?.headers?.get('date') ?? '')
    if (Number.isFinite(d)) {
      clockLoaded = true
      clockOffsetMs = d - Date.now()
      const v = JSON.stringify({ offset: clockOffsetMs, at: Date.now() })
      for (const store of ['sessionStorage', 'localStorage'] as const) {
        try {
          window[store].setItem(CLOCK_KEY, v)
        } catch {
          /* blocked */
        }
      }
    }
  } catch {
    /* no header: keep the last offset */
  }
}

/** The server's idea of "now" (ms). Close times are the server's, so the close clamp and checks use this, not the device clock. */
export function serverNow(): number {
  loadClock()
  return Date.now() + clockOffsetMs
}

const squash = (fp: string) => fp.replace(/\s+/g, '').toLowerCase()

/**
 * The fingerprint carried by the link in the Discord post (`?fp=...`), if this page was opened from it. It reaches the
 * browser without passing through this server's page, so it is the independent half of the check (a member who did not
 * come from Discord can compare the fingerprint on the page with the post by eye).
 */
export function discordFingerprintFromUrl(search: string): string | null {
  const v = new URLSearchParams(search).get('fp')
  return v && /^[0-9a-fA-F ]{32,40}$/.test(v) ? v : null
}

/** Fetch the proposal's key and check it: same fingerprint as the page and the Discord link showed, never changed since first seen, RSA >= 2048. */
async function trustedPublicKey(proposalId: string, pageFingerprint?: string | null): Promise<string> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/pubkey`, { cache: 'no-store' })
  noteServerDate(res)
  if (!res.ok) throw new Error('key')
  const { publicKey, fingerprint } = (await res.json()) as { publicKey: string; fingerprint: string }
  const computed = await fingerprintOfPem(publicKey)
  if (computed !== fingerprint) throw new Error('key fingerprint mismatch')
  if (pageFingerprint && squash(pageFingerprint) !== squash(computed)) throw new Error('key differs from the proposal page')
  let fromDiscord: string | null = null
  try {
    fromDiscord = discordFingerprintFromUrl(window.location.search)
  } catch {
    /* no window */
  }
  if (fromDiscord && squash(fromDiscord) !== squash(computed)) throw new Error('key differs from the Discord post')
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

export interface MineItem {
  id: string
  title: string
  tokenIssued: boolean
}

/** The /api/proposals/mine answer, validated: [] unless the feature is on and the shape is exactly as expected. */
export function parseMine(body: unknown): MineItem[] {
  if (!body || typeof body !== 'object') return []
  const b = body as { enabled?: unknown; proposals?: unknown }
  if (b.enabled !== true || !Array.isArray(b.proposals)) return []
  const out: MineItem[] = []
  for (const p of b.proposals) {
    if (!p || typeof p !== 'object') continue
    const { id, title, tokenIssued } = p as { id?: unknown; title?: unknown; tokenIssued?: unknown }
    if (typeof id === 'string' && /^[A-Za-z0-9_-]{8,60}$/.test(id) && typeof title === 'string') out.push({ id, title, tokenIssued: tokenIssued !== false })
  }
  return out
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
      noteServerDate(res)
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

export type VoteOutcome = 'ok' | 'closed' | 'invalid' | 'unavailable' | 'error'

/** Sends the vote with no cookies and no referrer: the request carries nothing but the token and the choice. */
export async function castVote(proposalId: string, ballot: Ballot, choice: Choice, opts: { keepalive?: boolean } = {}): Promise<VoteOutcome> {
  try {
    const res = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/vote`, {
      method: 'POST',
      credentials: 'omit',
      ...(opts.keepalive ? { keepalive: true } : typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? { signal: AbortSignal.timeout(20_000) } : {}),
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ballot.token, preparedMessage: ballot.preparedMessage, signature: ballot.signature, choice }),
    })
    noteServerDate(res)
    if (res.ok) return 'ok'
    // 409 is the server saying voting is over. 404 can also mean the feature was switched off for a while: not final.
    if (res.status === 409) return 'closed'
    if (res.status === 404) return 'unavailable'
    if (res.status === 401 || res.status === 400) return 'invalid'
    return 'error'
  } catch (e) {
    return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'unavailable' : 'error'
  }
}

/**
 * Send the vote now. (The random send delay lives in vote-queue.ts, which calls castVote when a queued vote is due; the
 * server also mixes votes before they reach the ballot table, see pending.ts. "ok" means the server durably recorded it.)
 */
export async function submitVote(proposalId: string, ballot: Ballot, choice: Choice): Promise<{ outcome: VoteOutcome; ballot: Ballot }> {
  const outcome = await castVote(proposalId, ballot, choice)
  if (outcome !== 'ok') return { outcome, ballot }
  const next: Ballot = { ...ballot, choice }
  saveBallot(proposalId, next)
  return { outcome, ballot: next }
}

/** Copy the vote code to the clipboard. */
export async function copyVoteCode(ballot: Ballot): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(encodeVoteCode(ballot))
    return true
  } catch {
    return false
  }
}
