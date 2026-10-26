/** Pure normalizers for the identifiers a disavowal is matched on. */

export type IdKind = 'MEMBER_ID' | 'DISCORD_ID' | 'X_HANDLE' | 'WALLET' | 'TELEGRAM' | 'NAME'
export interface IdentifierInput {
  kind: IdKind
  value: string
}

/** `<@123>`, `<@!123>` or `123` -> `123` (digits only); null if nothing usable. */
export function normalizeDiscordId(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return digits.length >= 5 && digits.length <= 25 ? digits : null
}

/** `@Foo`, `https://x.com/Foo?s=1`, `twitter.com/foo/` -> `foo`. */
export function normalizeXHandle(raw: string): string | null {
  let s = String(raw ?? '').trim()
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.|mobile\.)/i, '')
  s = s.replace(/^(x|twitter)\.com\//i, '')
  s = s.split(/[/?#]/)[0].replace(/^@/, '').toLowerCase()
  return /^[a-z0-9_]{1,15}$/.test(s) ? s : null
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** EVM -> lowercase `0x…`; Solana base58 keeps its case; anything else null. */
export function normalizeWallet(raw: string): string | null {
  const s = String(raw ?? '').trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s.toLowerCase()
  if (BASE58.test(s)) return s
  return null
}

export function normalizeTelegram(raw: string): string | null {
  let s = String(raw ?? '').trim()
  s = s.replace(/^https?:\/\//i, '').replace(/^(t\.me|telegram\.me)\//i, '')
  s = s.split(/[/?#]/)[0].replace(/^@/, '').toLowerCase()
  return /^[a-z0-9_]{4,32}$/.test(s) ? s : null
}

export function normalizeName(raw: string): string | null {
  const s = String(raw ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  return s.length >= 2 ? s : null
}

export function normalizeMemberId(raw: string): string | null {
  const s = String(raw ?? '').trim()
  return /^[A-Za-z0-9_-]{1,20}$/.test(s) ? s : null
}

const NORMALIZERS: Record<IdKind, (raw: string) => string | null> = {
  MEMBER_ID: normalizeMemberId,
  DISCORD_ID: normalizeDiscordId,
  X_HANDLE: normalizeXHandle,
  WALLET: normalizeWallet,
  TELEGRAM: normalizeTelegram,
  NAME: normalizeName,
}

export function isIdKind(k: unknown): k is IdKind {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(NORMALIZERS, k)
}

export function normalizeIdentifier(kind: IdKind, raw: string): string | null {
  return NORMALIZERS[kind](raw)
}

/**
 * Normalize and de-duplicate identifiers. `invalid` counts every input that
 * did not normalize so the caller can reject the request.
 */
export function buildIdentifiers(inputs: ReadonlyArray<{ kind: unknown; value: unknown }>): {
  identifiers: IdentifierInput[]
  invalid: number
} {
  const seen = new Set<string>()
  const identifiers: IdentifierInput[] = []
  let invalid = 0
  for (const i of inputs) {
    if (!isIdKind(i.kind) || typeof i.value !== 'string' || !i.value.trim()) {
      invalid++
      continue
    }
    const value = normalizeIdentifier(i.kind, i.value)
    if (!value) {
      invalid++
      continue
    }
    const key = `${i.kind}:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    identifiers.push({ kind: i.kind, value })
  }
  return { identifiers, invalid }
}

/** Kinds that may mark a profile as listed. Never NAME alone (collisions). */
export const MATCHABLE_KINDS: readonly IdKind[] = ['MEMBER_ID', 'DISCORD_ID', 'WALLET', 'X_HANDLE']
