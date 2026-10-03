/**
 * Reviewer information next to the pending queue (never blocks anything):
 *   - approved missions flagged because the member lost the underlying state
 *     (a role), set by the nightly run (D17: flag, never claw back);
 *   - duplicate-account signals for the members in the queue (§6.2).
 * Best effort: any failure (e.g. the Phase 2 tables not migrated yet) yields
 * empty lists, so the review queue itself always loads.
 */
import { prisma } from '../db'
import { SIGNAL_LABEL, signalsFor, type SignalKind } from './signals'

export interface FlaggedCompletionView {
  id: number
  discordId: string
  flaggedAt: string
  flagReason: string | null
  mission: { title: string; level: number; index: number }
}

export interface AccountSignalView {
  kind: SignalKind
  label: string
  key: string
  /** The other Discord accounts involved. */
  others: string[]
}

export async function getFlaggedCompletions(limit = 100): Promise<FlaggedCompletionView[]> {
  try {
    const rows = await prisma.missionCompletion.findMany({
      where: { status: 'APPROVED', flaggedAt: { not: null } },
      select: { id: true, discordId: true, flaggedAt: true, flagReason: true, mission: { select: { title: true, level: true, index: true } } },
      orderBy: { flaggedAt: 'desc' },
      take: limit,
    })
    return rows.map((r) => ({ ...r, flaggedAt: r.flaggedAt!.toISOString() }))
  } catch (e) {
    console.warn('[missions] flagged completions unavailable:', e instanceof Error ? e.message : e)
    return []
  }
}

export async function getSignalViews(discordIds: string[]): Promise<Map<string, AccountSignalView[]>> {
  const out = new Map<string, AccountSignalView[]>()
  try {
    const signals = await signalsFor(discordIds)
    for (const [discordId, list] of signals) {
      out.set(
        discordId,
        list.map((s) => ({ kind: s.kind, label: SIGNAL_LABEL[s.kind] ?? s.kind, key: s.key, others: s.discordIds.filter((d) => d !== discordId) })),
      )
    }
  } catch (e) {
    console.warn('[missions] account signals unavailable:', e instanceof Error ? e.message : e)
  }
  return out
}
