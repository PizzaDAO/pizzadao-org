import type { DecisionInput } from './decide'
import { REVIEW_ACTIONS, type DecisionAction } from './types'

/** Parse and bound the request body into a DecisionInput, or null when it is malformed. */
export function parseDecisionBody(b: unknown): { input: DecisionInput; expectedUpdatedAt: string | null } | null {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null
  const o = b as Record<string, unknown>
  if (typeof o.action !== 'string' || !(REVIEW_ACTIONS as readonly string[]).includes(o.action)) return null
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  const checklist: Record<string, boolean> = {}
  if (o.checklist && typeof o.checklist === 'object' && !Array.isArray(o.checklist)) {
    for (const [k, v] of Object.entries(o.checklist as Record<string, unknown>).slice(0, 20)) {
      if (typeof v === 'boolean' && /^[a-zA-Z]{1,40}$/.test(k)) checklist[k] = v
    }
  }
  return {
    input: {
      action: o.action as DecisionAction,
      note: str(o.note, 2001),
      proofRef: str(o.proofRef, 201),
      paidTo: str(o.paidTo, 201),
      ackFlagIds: Array.isArray(o.ackFlagIds) ? o.ackFlagIds.filter((x): x is string => typeof x === 'string').slice(0, 50) : [],
      ayesConfirmed: typeof o.ayesConfirmed === 'number' ? o.ayesConfirmed : undefined,
      asFraud: o.asFraud === true,
      checklist,
    },
    expectedUpdatedAt: typeof o.expectedUpdatedAt === 'string' ? o.expectedUpdatedAt : null,
  }
}
