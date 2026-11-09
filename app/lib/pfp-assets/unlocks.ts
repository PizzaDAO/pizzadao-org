// Pure unlock evaluation for PFP assets. An asset is unlocked when it is active AND any of its
// rules match (OR semantics) or the member holds a manual grant. No I/O: the loader (context.ts)
// builds the context.
import type { AssetLike, AssetRule } from './types'

export interface UnlockContext {
  level: number
  roleIds: ReadonlySet<string> | readonly string[]
  approvedMissionIds: ReadonlySet<number> | readonly number[]
  itemIds: ReadonlySet<number> | readonly number[]
  /** Asset ids the member was manually granted. */
  grantIds: ReadonlySet<number> | readonly number[]
}

const has = <T>(c: ReadonlySet<T> | readonly T[], v: T) =>
  c instanceof Set ? c.has(v) : (c as readonly T[]).includes(v)

export function ruleMatches(rule: AssetRule, ctx: UnlockContext): boolean {
  const p = rule.params ?? {}
  switch (rule.kind) {
    case 'everyone':
      return true
    case 'level': {
      const min = Number(p.minLevel)
      return Number.isFinite(min) && ctx.level >= min
    }
    case 'role':
      return typeof p.roleId === 'string' && has(ctx.roleIds, p.roleId)
    case 'mission':
      return has(ctx.approvedMissionIds, Number(p.missionId))
    case 'item':
      return has(ctx.itemIds, Number(p.itemId))
    default:
      return false
  }
}

/** Ids of the assets the member can use right now. Inactive assets are never unlocked. */
export function unlockedAssetIds(assets: ReadonlyArray<AssetLike>, ctx: UnlockContext): Set<number> {
  const out = new Set<number>()
  for (const a of assets) {
    if (!a.isActive) continue
    if (has(ctx.grantIds, a.id) || a.rules.some((r) => ruleMatches(r, ctx))) out.add(a.id)
  }
  return out
}
