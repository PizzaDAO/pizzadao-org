/**
 * The built-in role income table and its types. Pure data (no imports), so the settings registry
 * can use it as the code default and the ceiling for the admin page without an import cycle.
 */
export interface RoleIncome {
  /** Discord role name, as shown in the server. */
  name: string
  /** PEP paid per interval. */
  amount: number
  /** Hours between collections (UB: 1 day for every role). */
  intervalHours: number
  /** Discord role id. Optional: resolved by name when absent. */
  roleId?: string
}

/** Live UB role income, read from the UB dashboard on 2026-10-03. */
export const DEFAULT_ROLE_INCOME: readonly RoleIncome[] = [
  { name: 'Pizzaiolo', amount: 690, intervalHours: 24 },
  { name: 'Dread Pizza Roberts', amount: 420, intervalHours: 24, roleId: '812131585327235113' },
  { name: 'Pizza Holder', amount: 69, intervalHours: 24 },
  { name: 'Pizza Mafia', amount: 69, intervalHours: 24 },
  { name: 'Pizza Capo', amount: 69, intervalHours: 24, roleId: '839206162837798945' },
  { name: 'Crew Member', amount: 42, intervalHours: 24 },
  { name: 'Box Mafia', amount: 42, intervalHours: 24 },
  { name: 'Pizza Sticks Holder', amount: 8, intervalHours: 24 },
  { name: 'Pizza Pop Holder', amount: 8, intervalHours: 24 },
  { name: 'Pizza Tattoo Club', amount: 8, intervalHours: 24 },
  { name: 'Pockets Checked', amount: 1, intervalHours: 24 },
]

export function validEntry(e: unknown): e is RoleIncome {
  const r = e as RoleIncome
  return (
    !!r &&
    typeof r.name === 'string' &&
    r.name.trim().length > 0 &&
    Number.isInteger(r.amount) &&
    r.amount > 0 &&
    typeof r.intervalHours === 'number' &&
    r.intervalHours > 0 &&
    (r.roleId === undefined || (typeof r.roleId === 'string' && /^\d{5,25}$/.test(r.roleId)))
  )
}

/** The ROLE_INCOME_JSON table when it is set and valid; null otherwise. */
export function parseRoleIncomeEnv(raw: string | undefined): RoleIncome[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const rows = parsed.map((e) => ({ intervalHours: 24, ...e }))
    return rows.length && rows.every(validEntry) ? rows : null
  } catch {
    return null
  }
}

/** The table in force when nothing is saved: the env table if set and valid, else the built-in one. */
export function roleIncomeBaseline(raw: string | undefined = process.env.ROLE_INCOME_JSON): readonly RoleIncome[] {
  return parseRoleIncomeEnv(raw) ?? DEFAULT_ROLE_INCOME
}

/** Lowercase, letters and digits only ("🍕 Pizza-Holder" -> "pizzaholder"). */
export function normalizeRoleName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}
