/**
 * Box Mafia suggestion (woodfired-65373).
 *
 * The dashboard nudges members who definitely lack the "Box Mafia" Discord
 * role to buy a Rare Pizzas Box. Fails closed: any unknown (no bot token,
 * Discord down, role not found by name) yields "unknown" and the card hides.
 */
import { normalizeRoleName, roleIncomeConfig } from './pep-earn/income'

export const BOX_MAFIA_ROLE_NAME = 'Box Mafia'
export const DEFAULT_BOX_PURCHASE_URL = 'https://opensea.io/collection/rare-pizzas-box'

/** Purchase link. An explicitly empty NEXT_PUBLIC_BOX_PURCHASE_URL (or whitespace) hides the card. */
export const BOX_PURCHASE_URL = (process.env.NEXT_PUBLIC_BOX_PURCHASE_URL ?? DEFAULT_BOX_PURCHASE_URL).trim()

export type BoxMafiaStatus = 'has_role' | 'missing' | 'unknown'

/** The Box Mafia entry of the role income table (honours ROLE_INCOME_JSON). */
export function boxMafiaIncomeEntry() {
  const target = normalizeRoleName(BOX_MAFIA_ROLE_NAME)
  return roleIncomeConfig().find((e) => normalizeRoleName(e.name) === target)
}

/** Daily PEP for Box Mafia holders, per the role income table. */
export function boxMafiaDailyPep(): number {
  return boxMafiaIncomeEntry()?.amount ?? 42
}

/** BOX_MAFIA_ROLE_ID env override, then the income entry's roleId, else the single guild role named "Box Mafia". */
export function resolveBoxMafiaRoleId(
  guildRoles: ReadonlyArray<{ id: string; name: string }> | null,
): string | null {
  const override = (process.env.BOX_MAFIA_ROLE_ID ?? '').trim()
  if (/^\d{5,25}$/.test(override)) return override
  const configured = boxMafiaIncomeEntry()?.roleId
  if (configured) return configured
  if (!guildRoles) return null
  const target = normalizeRoleName(BOX_MAFIA_ROLE_NAME)
  const matches = guildRoles.filter((r) => normalizeRoleName(r.name) === target)
  return matches.length === 1 ? matches[0].id : null
}

export function boxMafiaStatus(memberRoles: string[] | null, roleId: string | null): BoxMafiaStatus {
  if (!memberRoles || !roleId) return 'unknown'
  return memberRoles.includes(roleId) ? 'has_role' : 'missing'
}
