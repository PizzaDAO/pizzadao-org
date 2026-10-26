import { DAY_MS, DISAVOW_DECISION_DAYS, DISAVOW_YES_THRESHOLD } from './constants'

export type VoteChoice = 'YES' | 'NO' | 'ABSTAIN' | 'RECUSE'
export interface TallyVote {
  voterDiscordId: string
  choice: VoteChoice
}
export interface TallyInput {
  /** Discord id of whoever opened the nomination (their vote never counts). */
  nominatorId: string
  /** Discord ids of the person being voted on (their vote never counts). */
  subjectIds: readonly string[]
  /** Anyone else who submitted a nomination for this entry (their vote never counts either). */
  submitterIds?: readonly string[]
  now: Date
  opensAt: Date
  closesAt: Date
}
export interface TallyResult {
  yes: number
  no: number
  abstain: number
  recused: number
  outcome: 'pending' | 'passed' | 'failed'
}

/**
 * Count a round. Nothing is decided before opensAt + 7 days. After that it
 * passes when yes >= threshold AND yes > no, and fails at closesAt otherwise. The nominator's and subject's
 * votes are ignored even if they got in (the API also rejects them). The same
 * rule serves LIST, REMOVE and REAFFIRM; the caller decides what pass means.
 */
export function tallyRound(votes: readonly TallyVote[], ctx: TallyInput): TallyResult {
  const excluded = new Set<string>([ctx.nominatorId, ...ctx.subjectIds, ...(ctx.submitterIds ?? [])])
  const latest = new Map<string, VoteChoice>()
  for (const v of votes) if (!excluded.has(v.voterDiscordId)) latest.set(v.voterDiscordId, v.choice)
  let yes = 0, no = 0, abstain = 0, recused = 0
  for (const c of latest.values()) {
    if (c === 'YES') yes++
    else if (c === 'NO') no++
    else if (c === 'ABSTAIN') abstain++
    else recused++
  }
  // Nothing is decided before the fixed decision time, however many votes are in.
  const decideAt = ctx.opensAt.getTime() + DISAVOW_DECISION_DAYS * DAY_MS
  let outcome: TallyResult['outcome'] = 'pending'
  if (ctx.now.getTime() >= decideAt) {
    if (yes >= DISAVOW_YES_THRESHOLD && yes > no) outcome = 'passed'
    else if (ctx.now.getTime() >= ctx.closesAt.getTime()) outcome = 'failed'
  }
  return { yes, no, abstain, recused, outcome }
}

export function windowEnd(opensAt: Date, days: number): Date {
  return new Date(opensAt.getTime() + days * DAY_MS)
}
