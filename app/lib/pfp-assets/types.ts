// Shared types and pure helpers for PFP asset unlocks. No I/O in this file.

export const ASSET_KINDS = ['background', 'outfit', 'frame', 'accessory', 'badge'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const RULE_KINDS = ['level', 'role', 'mission', 'item', 'everyone'] as const
export type RuleKind = (typeof RULE_KINDS)[number]

/** Max layers per kind (one background, one outfit, one frame, up to 3 accessories, one badge). */
export const KIND_LIMITS: Record<AssetKind, number> = { background: 1, outfit: 1, frame: 1, accessory: 3, badge: 1 }

/** Z-order, bottom to top. The base image sits between background and outfit. */
export const KIND_ORDER: readonly AssetKind[] = ['background', 'outfit', 'accessory', 'frame', 'badge']

/** Kinds members can move, scale and rotate (the rest are fixed full-canvas layers). */
export function isTransformable(kind: AssetKind | string | undefined): boolean {
  return kind === 'accessory' || kind === 'outfit'
}

export const CANVAS_SIZE = 1024

export interface AssetRule {
  kind: RuleKind
  params: Record<string, unknown>
}

export interface AssetLike {
  id: number
  isActive: boolean
  kind?: string
  rules: ReadonlyArray<AssetRule>
}

export interface Transform {
  x: number
  y: number
  scale: number
  rotation: number
}

export interface Layer extends Transform {
  assetId: number
}

export function isAssetKind(v: unknown): v is AssetKind {
  return typeof v === 'string' && (ASSET_KINDS as readonly string[]).includes(v)
}

export function isRuleKind(v: unknown): v is RuleKind {
  return typeof v === 'string' && (RULE_KINDS as readonly string[]).includes(v)
}

const SNOWFLAKE = /^\d{5,25}$/

/**
 * Structural validation of one rule (no database access). Returns the cleaned rule or an error
 * string. Existence checks (role / mission / item) happen in catalog.ts.
 */
export function parseRule(input: unknown): { ok: true; rule: AssetRule } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid rule' }
  const { kind, params } = input as { kind?: unknown; params?: unknown }
  if (!isRuleKind(kind)) return { ok: false, error: 'Unknown rule kind' }
  const p = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  switch (kind) {
    case 'everyone':
      return { ok: true, rule: { kind, params: {} } }
    case 'level': {
      const n = Number(p.minLevel)
      if (!Number.isInteger(n) || n < 1 || n > 99) return { ok: false, error: 'minLevel must be a whole number from 1 to 99' }
      return { ok: true, rule: { kind, params: { minLevel: n } } }
    }
    case 'role': {
      const id = String(p.roleId ?? '').trim()
      if (!SNOWFLAKE.test(id)) return { ok: false, error: 'roleId must be a Discord role id' }
      return { ok: true, rule: { kind, params: { roleId: id } } }
    }
    case 'mission': {
      const n = Number(p.missionId)
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'missionId must be a positive whole number' }
      return { ok: true, rule: { kind, params: { missionId: n } } }
    }
    case 'item': {
      const n = Number(p.itemId)
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'itemId must be a positive whole number' }
      return { ok: true, rule: { kind, params: { itemId: n } } }
    }
  }
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Clean a client-supplied transform; anything non-numeric falls back to the asset default. */
export function cleanTransform(input: unknown, fallback?: Partial<Transform> | null): Transform {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const f = fallback ?? {}
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    x: clamp(num(o.x, f.x ?? 0.5), 0, 1),
    y: clamp(num(o.y, f.y ?? 0.5), 0, 1),
    scale: clamp(num(o.scale, f.scale ?? 1), 0.1, 3),
    rotation: clamp(num(o.rotation, f.rotation ?? 0), -360, 360),
  }
}

export interface LockLookups {
  levelTitles: ReadonlyMap<number, string>
  roleNames: ReadonlyMap<string, string>
  missionTitles: ReadonlyMap<number, string>
  itemNames: ReadonlyMap<number, string>
}

/** What a locked asset tells the member: the admin hint, else one line built from its rules. */
export function lockHint(
  asset: { lockedHint?: string | null; rules: ReadonlyArray<AssetRule> },
  lookups: Partial<LockLookups> = {},
): string {
  const hint = asset.lockedHint?.trim()
  if (hint) return hint
  const parts: string[] = []
  for (const r of asset.rules) {
    const p = r.params
    if (r.kind === 'level') {
      const lvl = Number(p.minLevel)
      const title = lookups.levelTitles?.get(lvl)
      parts.push(`Reach Level ${lvl}${title ? ` - ${title}` : ''}`)
    } else if (r.kind === 'role') {
      const name = lookups.roleNames?.get(String(p.roleId))
      parts.push(name ? `${name} only` : 'A special role')
    } else if (r.kind === 'mission') {
      const t = lookups.missionTitles?.get(Number(p.missionId))
      parts.push(t ? `Complete "${t}"` : 'Complete a mission')
    } else if (r.kind === 'item') {
      const n = lookups.itemNames?.get(Number(p.itemId))
      parts.push(n ? `Own ${n}` : 'Own a special item')
    }
  }
  return parts.length ? parts.join(' or ') : 'Not available yet'
}
