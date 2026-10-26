import {
  DISAVOW_MAX_COMMENT, DISAVOW_MAX_EVIDENCE, DISAVOW_MAX_NAME, DISAVOW_MAX_RESPONSE, DISAVOW_MAX_STATEMENT,
} from './constants'
import { buildIdentifiers, normalizeName, type IdentifierInput } from './identity'

export const REASONS = ['SCAM', 'THEFT_OF_FUNDS', 'NON_DELIVERY', 'IMPERSONATION', 'HARASSMENT', 'OTHER'] as const
export type DisavowReasonValue = (typeof REASONS)[number]
export const VOTE_CHOICES = ['YES', 'NO', 'ABSTAIN', 'RECUSE'] as const

export interface NominationInput {
  displayName: string
  reason: DisavowReasonValue
  statement: string
  evidenceUrls: string[]
  identifiers: IdentifierInput[]
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
const MAX_URL = 500
const MAX_IDENTIFIERS = 10

function isObj(b: unknown): b is Record<string, unknown> {
  return typeof b === 'object' && b !== null && !Array.isArray(b)
}

/** https-only, parseable, no credentials, bounded length. */
export function isHttpsUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > MAX_URL) return false
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname
  } catch {
    return false
  }
}

export function parseNomination(body: unknown): Parsed<NominationInput> {
  if (!isObj(body)) return { ok: false, error: 'Invalid body' }
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName || displayName.length > DISAVOW_MAX_NAME) return { ok: false, error: 'Invalid name' }
  if (!REASONS.includes(body.reason as DisavowReasonValue)) return { ok: false, error: 'Invalid reason' }
  const statement = typeof body.statement === 'string' ? body.statement.trim() : ''
  if (statement.length < 20 || statement.length > DISAVOW_MAX_STATEMENT) return { ok: false, error: 'Invalid statement' }
  if (body.attest !== true) return { ok: false, error: 'Attestation required' }

  const urlsRaw = body.evidenceUrls ?? []
  if (!Array.isArray(urlsRaw) || urlsRaw.length > DISAVOW_MAX_EVIDENCE) return { ok: false, error: 'Too many evidence links' }
  if (!urlsRaw.every(isHttpsUrl)) return { ok: false, error: 'Evidence links must be https URLs' }
  const evidenceUrls = [...new Set((urlsRaw as string[]).map(u => u.trim()))]

  const idsRaw = body.identifiers ?? []
  if (!Array.isArray(idsRaw) || idsRaw.length > MAX_IDENTIFIERS) return { ok: false, error: 'Invalid identifiers' }
  const { identifiers, invalid } = buildIdentifiers(idsRaw.filter(isObj) as Array<{ kind: unknown; value: unknown }>)
  if (invalid > 0 || idsRaw.some(i => !isObj(i))) return { ok: false, error: 'Invalid identifier' }
  if (identifiers.length === 0) {
    const n = normalizeName(displayName)
    if (!n) return { ok: false, error: 'Invalid name' }
    identifiers.push({ kind: 'NAME', value: n })
  }
  return { ok: true, value: { displayName, reason: body.reason as DisavowReasonValue, statement, evidenceUrls, identifiers } }
}

export function parseVote(body: unknown): Parsed<{ roundId: string; choice: (typeof VOTE_CHOICES)[number]; comment: string | null }> {
  if (!isObj(body)) return { ok: false, error: 'Invalid body' }
  if (typeof body.roundId !== 'string' || !body.roundId) return { ok: false, error: 'Invalid round' }
  if (!VOTE_CHOICES.includes(body.choice as never)) return { ok: false, error: 'Invalid choice' }
  const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null
  if (comment && comment.length > DISAVOW_MAX_COMMENT) return { ok: false, error: 'Comment too long' }
  return { ok: true, value: { roundId: body.roundId, choice: body.choice as never, comment } }
}

export function parseResponseText(body: unknown): Parsed<string> {
  if (!isObj(body) || typeof body.text !== 'string') return { ok: false, error: 'Invalid body' }
  const text = body.text.trim()
  if (!text || text.length > DISAVOW_MAX_RESPONSE) return { ok: false, error: 'Invalid response' }
  return { ok: true, value: text }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
