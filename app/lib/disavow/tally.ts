import { DAY_MS, DISAVOW_MIN_OPEN_HOURS, DISAVOW_YES_THRESHOLD, HOUR_MS } from './constants'

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
 * Count a round. Passes when yes >= threshold AND yes > no AND the round has
 * been open 72h. Fails at closesAt otherwise. The nominator's and subject's
 * votes are ignored even if they got in (the API also rejects them). The same
 * rule serves LIST, REMOVE and REAFFIRM; the caller decides what pass means.
 */
export function tallyRound(votes: readonly TallyVote[], ctx: TallyInput): TallyResult {
  const excluded = new Set<string>([ctx.nominatorId, ...ctx.subjectIds])
  const latest = new Map<string, VoteChoice>()
  for (const v of votes) if (!excluded.has(v.voterDiscordId)) latest.set(v.voterDiscordId, v.choice)
  let yes = 0, no = 0, abstain = 0, recused = 0
  for (const c of latest.values()) {
    if (c === 'YES') yes++
    else if (c === 'NO') no++
    else if (c === 'ABSTAIN') abstain++
    else recused++
  }
  const floor = ctx.opensAt.getTime() + DISAVOW_MIN_OPEN_HOURS * HOUR_MS
  const passed = yes >= DISAVOW_YES_THRESHOLD && yes > no && ctx.now.getTime() >= floor
  let outcome: TallyResult['outcome'] = 'pending'
  if (passed) outcome = 'passed'
  else if (ctx.now.getTime() >= ctx.closesAt.getTime()) outcome = 'failed'
  return { yes, no, abstain, recused, outcome }
}

export function windowEnd(opensAt: Date, days: number): Date {
  return new Date(opensAt.getTime() + days * DAY_MS)
}
