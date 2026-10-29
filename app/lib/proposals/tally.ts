/**
 * The pass rule (pure). Decided only at closesAt, never early:
 *   passed when (ayes + abstains) >= ayesNeeded AND ayes > nays.
 * The rule shape comes from the proposal's own snapshot, not from current settings.
 */
export interface BallotCounts {
  ayes: number
  nays: number
  abstains: number
}

export interface PassRule {
  ayesNeeded: number
  countAbstains: boolean
  requireAyesOverNays: boolean
}

export interface TallyResult extends BallotCounts {
  counted: number
  outcome: 'pending' | 'passed' | 'failed'
}

export function tallyProposal(counts: BallotCounts, rule: PassRule, now: Date, closesAt: Date): TallyResult {
  const counted = counts.ayes + (rule.countAbstains ? counts.abstains : 0)
  if (now.getTime() < closesAt.getTime()) return { ...counts, counted, outcome: 'pending' }
  const passes = counted >= rule.ayesNeeded && (!rule.requireAyesOverNays || counts.ayes > counts.nays)
  return { ...counts, counted, outcome: passes ? 'passed' : 'failed' }
}

export function countBallots(rows: ReadonlyArray<{ choice: 'AYE' | 'NAY' | 'ABSTAIN' }>): BallotCounts {
  let ayes = 0, nays = 0, abstains = 0
  for (const r of rows) {
    if (r.choice === 'AYE') ayes++
    else if (r.choice === 'NAY') nays++
    else abstains++
  }
  return { ayes, nays, abstains }
}
