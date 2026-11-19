/**
 * Seed L3.2 "Complete a task from a crew" (verifier crew_task_done, app/lib/mission-verify/verifiers-activity.ts).
 *
 *   node scripts/missions/add-crew-task-mission.ts
 *       dry run (default): prints what it would do, writes nothing.
 *   ... --apply
 *       inserts the mission INACTIVE (isActive false, so no level changes yet). Idempotent: nothing is
 *       inserted when a crew_task_done mission already exists, or when (level 3, index 2) is taken.
 *   ... --activate [--apply]
 *       activates the existing crew_task_done mission (re-activating is allowed; the admin missions
 *       route can do the same: PATCH isActive true on /admin/missions). Combine with --apply to write.
 *
 * Activating an active required L3 mission cannot drop anyone's level: a level whose reward was already
 * paid counts as completed (computeCurrentLevel paidLevels). Needs DATABASE_URL. Run with Node 24.
 */
import { register } from 'node:module'

register('../members/alias-hooks.mjs', import.meta.url)

const LEVEL = 3
const INDEX = 2
const REWARD = 1337
const TITLE = 'Complete a task from a crew'
const DESCRIPTION =
  'Claim an open task on a crew page (or with /task list and /task claim in Discord), do the work, then ask the crew lead to mark it Done. Checked automatically once a crew lead marks a task you lead as Done. Marking your own task Done does not count.'
const GUIDE_HREF = '/handbook/levels#crew-task'

async function main() {
  const apply = process.argv.includes('--apply')
  const activate = process.argv.includes('--activate')
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2) }
  const { prisma } = await import('../../app/lib/db.ts')
  try {
    const existing = await prisma.mission.findFirst({ where: { verifierKey: 'crew_task_done' }, select: { id: true, level: true, index: true, isActive: true } })
    console.log(apply ? 'Mode: --apply' : 'Mode: dry run (add --apply to write)')

    if (existing) {
      console.log(`crew_task_done mission already exists: id ${existing.id} (L${existing.level}.${existing.index}), active: ${existing.isActive}`)
      if (activate && !existing.isActive) {
        console.log(`${apply ? 'Activating' : 'Would activate'} mission ${existing.id}`)
        if (apply) await prisma.mission.update({ where: { id: existing.id }, data: { isActive: true } })
      } else if (activate) {
        console.log('Already active: nothing to do')
      }
      return
    }
    if (activate) console.log('No crew_task_done mission yet: inserting it (inactive); run --activate again afterwards')

    const taken = await prisma.mission.findUnique({ where: { level_index: { level: LEVEL, index: INDEX } }, select: { id: true, title: true } })
    if (taken) {
      console.error(`L${LEVEL}.${INDEX} is taken by mission ${taken.id} ("${taken.title}"): not inserting`)
      process.exit(1)
    }
    // Same level title as its siblings (it names the level on the reward ledger).
    const sibling = await prisma.mission.findFirst({ where: { level: LEVEL, levelTitle: { not: null } }, select: { levelTitle: true } })
    const row = {
      level: LEVEL, index: INDEX, title: TITLE, levelTitle: sibling?.levelTitle ?? null, description: DESCRIPTION, reward: REWARD, isActive: false, bonus: false,
      verifierKey: 'crew_task_done', proofKind: 'NONE' as const, guideHref: GUIDE_HREF,
    }
    console.log(`${apply ? 'Inserting' : 'Would insert'}:`, JSON.stringify(row))
    if (apply) {
      const created = await prisma.mission.create({ data: row, select: { id: true } })
      console.log(`Inserted mission ${created.id} (inactive). Activate with: node scripts/missions/add-crew-task-mission.ts --activate --apply`)
    }
  } finally {
    await (prisma as { $disconnect?: () => Promise<void> }).$disconnect?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
