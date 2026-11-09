// GET   /api/admin/unlock-tickets: every lock on the ticket list.
// POST  /api/admin/unlock-tickets: { action: 'discover', dryRun? } | { action: 'add', networkId, address, name?, year? } | { action: 'seed' }
// PATCH /api/admin/unlock-tickets: { ids: number[], enabled: boolean } enable or disable locks.
// Dread Pizza Roberts only (same gate as the PFP admin).
import { pfpAdminRoute, jsonBody } from '@/app/lib/pfp-assets/admin-route'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { prisma } from '@/app/lib/db'
import { addLockByAddress, discoverLocks, seedLocks } from '@/app/lib/unlock/locks'
import { CHAINS } from '@/app/lib/unlock/subgraph'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function listAll() {
  const locks = await prisma.unlockLock.findMany({ orderBy: [{ year: 'desc' }, { name: 'asc' }] })
  return { locks, chains: CHAINS }
}

export const GET = pfpAdminRoute(async () => listAll())

export const POST = pfpAdminRoute(async (req) => {
  const body = await jsonBody(req)
  if (body.action === 'discover') {
    const results = await discoverLocks({ dryRun: body.dryRun === true })
    return { results, ...(await listAll()) }
  }
  if (body.action === 'seed') {
    const added = await seedLocks()
    return { added, ...(await listAll()) }
  }
  if (body.action === 'add') {
    const networkId = Number(body.networkId)
    const year = body.year == null || body.year === '' ? null : Number(body.year)
    if (year != null && (!Number.isInteger(year) || year < 2010 || year > 2100)) throw new ValidationError('Year looks wrong')
    try {
      await addLockByAddress({
        networkId,
        address: String(body.address ?? ''),
        name: typeof body.name === 'string' ? body.name : undefined,
        year,
      })
    } catch (e) {
      throw new ValidationError(e instanceof Error ? e.message : 'Could not add that lock')
    }
    return listAll()
  }
  throw new ValidationError('Unknown action')
})

export const PATCH = pfpAdminRoute(async (req) => {
  const body = await jsonBody(req)
  const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)).slice(0, 2000) : []
  if (ids.length === 0 || typeof body.enabled !== 'boolean') throw new ValidationError('ids and enabled are required')
  await prisma.unlockLock.updateMany({ where: { id: { in: ids } }, data: { enabled: body.enabled } })
  return listAll()
})
