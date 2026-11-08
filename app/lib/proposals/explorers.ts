/**
 * Block explorer links for historical proposal payments (plans/proposals-history-import.md).
 * Rows store only the chain key and the transaction hash; the URL pattern is the proposals.explorers setting
 * (JSON, chain key -> https URL containing {tx}), falling back to these defaults. Pure.
 */
export const DEFAULT_EXPLORERS: Readonly<Record<string, string>> = {
  ethereum: 'https://etherscan.io/tx/{tx}',
  base: 'https://basescan.org/tx/{tx}',
  optimism: 'https://optimistic.etherscan.io/tx/{tx}',
  polygon: 'https://polygonscan.com/tx/{tx}',
  arbitrum: 'https://arbiscan.io/tx/{tx}',
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/

export function isTxHash(h: string | null | undefined): h is string {
  return typeof h === 'string' && TX_HASH.test(h)
}

function validPattern(p: unknown): p is string {
  if (typeof p !== 'string' || !p.includes('{tx}') || p.length > 300) return false
  try {
    const u = new URL(p.replace('{tx}', '0x0'))
    return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname
  } catch {
    return false
  }
}

/** Setting text -> map. Empty or unusable text gives the defaults; bad entries are dropped, never trusted. */
export function parseExplorers(text: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_EXPLORERS }
  const t = (text ?? '').trim()
  if (!t) return out
  try {
    const j = JSON.parse(t) as unknown
    if (!j || typeof j !== 'object' || Array.isArray(j)) return out
    for (const [chain, pattern] of Object.entries(j as Record<string, unknown>)) {
      if (/^[a-z][a-z0-9_-]{0,30}$/.test(chain) && validPattern(pattern)) out[chain] = pattern
    }
  } catch {
    /* fall back to the defaults */
  }
  return out
}

/** True when the setting text is empty or a JSON object whose every entry is a valid chain key and https pattern. */
export function explorersTextValid(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  try {
    const j = JSON.parse(t) as unknown
    if (!j || typeof j !== 'object' || Array.isArray(j)) return false
    return Object.entries(j as Record<string, unknown>).every(([c, p]) => /^[a-z][a-z0-9_-]{0,30}$/.test(c) && validPattern(p))
  } catch {
    return false
  }
}

/** The explorer URL for a transaction, or null for an unknown chain, an off-chain payment or a malformed hash. */
export function explorerTxUrl(chain: string | null | undefined, txHash: string | null | undefined, explorers: Readonly<Record<string, string>> = DEFAULT_EXPLORERS): string | null {
  if (!chain || !isTxHash(txHash)) return null
  const pattern = Object.prototype.hasOwnProperty.call(explorers, chain) ? explorers[chain] : null
  if (!validPattern(pattern)) return null
  return pattern.replace('{tx}', txHash)
}
