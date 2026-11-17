/** Nightly re-check of members whose rsv.pizza matches are stale (rsv.pizza allows 60 requests a minute). */
import { loadEventsAttendedConfig } from './config'
import { listDueMembers, refreshRsvEvents } from './rsv'

export interface RsvEventsRun {
  enabled: boolean
  due: number
  checked: number
  failed: number
  timedOut: boolean
}

export async function runRsvEventsRefresh(
  opts: { budgetMs?: number; batch?: number; gapMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RsvEventsRun> {
  const config = await loadEventsAttendedConfig()
  if (!config.enabled) return { enabled: false, due: 0, checked: 0, failed: 0, timedOut: false }
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const budgetMs = opts.budgetMs ?? 200_000
  const gapMs = opts.gapMs ?? 1_200
  const started = now()
  const due = await listDueMembers(config.rsvRecheckDays, opts.batch ?? 100)
  let checked = 0
  let failed = 0
  let timedOut = false
  for (const memberId of due) {
    if (now() - started > budgetMs) {
      timedOut = true
      break
    }
    const r = await refreshRsvEvents(memberId).catch(() => ({ ok: false as const }))
    if (r.ok) checked++
    else failed++
    await sleep(gapMs)
  }
  return { enabled: true, due: due.length, checked, failed, timedOut }
}
