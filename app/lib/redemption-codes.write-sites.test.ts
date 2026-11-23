// @vitest-environment node
//
// Guard: every place that writes Inventory must keep the Proof of Pizza codes in step
// (plans/proof-of-pizza-codes.md). A new write site fails this test until it is added to the list below
// AND calls reconcileRedemptionCodes (or, for redemption-codes.ts itself, handles the codes inline).
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const WRITE = /\.inventory\.(upsert|update|updateMany|delete|deleteMany|create|createMany)\b|"Inventory"/

/** Files allowed to write Inventory, with whether they must call the reconcile helper. */
const KNOWN: Record<string, { mustReconcile: boolean }> = {
  'app/lib/shop.ts': { mustReconcile: true },
  'app/lib/shop-admin.ts': { mustReconcile: true },
  'app/lib/shop-grants.ts': { mustReconcile: true },
  'app/api/inventory/send/route.ts': { mustReconcile: true },
  'app/lib/redemption-codes.ts': { mustReconcile: false }, // redeemCode consumes the unit and the code together
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec)\.|\.concurrency\./.test(name)) out.push(full)
  }
  return out
}

describe('Inventory write sites', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'scripts'))]
  const writers = files.filter((f) => WRITE.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))

  it('are exactly the known list (a new one must reconcile codes)', () => {
    // The admin shop client and the UB export only mention "Inventory" in copy, not writes.
    const unexpected = writers.filter((f) => !(f in KNOWN) && !/ShopAdminClient\.tsx$|unbelievaboat\/export\.mjs$/.test(f))
    expect(unexpected).toEqual([])
  })

  it.each(Object.entries(KNOWN).filter(([, v]) => v.mustReconcile))('%s calls reconcileRedemptionCodes', (file) => {
    expect(readFileSync(path.join(ROOT, file), 'utf8')).toMatch(/reconcileRedemptionCodes\(/)
  })

  it('the known files all still exist and write', () => {
    for (const f of Object.keys(KNOWN)) expect(writers).toContain(f)
  })
})
