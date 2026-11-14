/**
 * Automatic verifiers for the "Anytime" bonus missions (level 0): each counts qualifying rows
 * for the member and passes at `min`. Counting lives in VerifierSources.countActivity.
 *
 *   pizzeria_checkin  an approved pizzeria check-in (PizzeriaCheckIn)
 *   passport_stamps   `min` Passport stamps (PassportStamp)
 *   spotlight         featured in the Spotlight (SpotlightSubmission status FEATURED)
 *   shop_purchase     bought a shop item (SHOP_PURCHASE in the PEP ledger)
 *   bounty_or_job     completed a bounty, or was paid for a job
 *   article_published a published Article
 *   buddy_completed   a COMPLETED buddy pairing, as the buddy
 *   social_linked     a Telegram or Farcaster account linked (not X: that is level 1)
 *
 * Call streaks use attendance_count with { min, windowDays, crewId } (verifiers.ts); a post with
 * likes uses social_post with { minReplies: 0, minLikes } (semi.ts); hosting a party is gpp_host.
 */
import { asObject, positiveInt, stringList, type ActivityKind, type Verifier, type VerifyResult } from './types'

const fail = (reason: string, hint?: string, progress?: { have: number; need: number }): VerifyResult => ({
  status: 'fail',
  reason,
  ...(hint ? { hint } : {}),
  ...(progress ? { progress } : {}),
})

function counting(opts: {
  key: string
  kind: ActivityKind
  defaultMin: number
  noun: string
  hint: string
}): Verifier<{ min: number }> {
  return {
    key: opts.key,
    mode: 'auto',
    stateful: false,
    parse: (p) => ({ min: positiveInt(asObject(p).min, 'min', opts.defaultMin) }),
    async check(ctx, { min }) {
      if (!ctx.sources.countActivity) return { status: 'unknown', reason: "Can't check this right now" }
      let n: number
      try {
        n = await ctx.sources.countActivity(opts.kind, ctx.discordId, ctx.memberId)
      } catch {
        return { status: 'unknown', reason: "Couldn't read your activity right now" }
      }
      if (n >= min) return { status: 'pass', evidence: { count: n, need: min } }
      return fail(`${n}/${min} ${opts.noun}`, opts.hint, { have: n, need: min })
    },
  }
}

export const pizzeriaCheckin = counting({
  key: 'pizzeria_checkin',
  kind: 'pizzeria_checkin',
  defaultMin: 1,
  noun: 'pizzeria check-ins',
  hint: 'Check in at a pizzeria from your Passport page.',
})

export const passportStamps = counting({
  key: 'passport_stamps',
  kind: 'passport_stamp',
  defaultMin: 5,
  noun: 'Passport stamps',
  hint: 'Collect stamps by checking in at pizzerias from your Passport page.',
})

export const spotlightFeatured = counting({
  key: 'spotlight',
  kind: 'spotlight_featured',
  defaultMin: 1,
  noun: 'Spotlight features',
  hint: 'Submit yourself (or get nominated) on the Spotlight page; featured members count.',
})

export const shopPurchase = counting({
  key: 'shop_purchase',
  kind: 'shop_purchase',
  defaultMin: 1,
  noun: 'shop purchases',
  hint: 'Buy any item from the shop.',
})

/**
 * Completed bounties (`min`, default 1), OR paid jobs when `minJobs` is set (a single daily job
 * is too easy, so jobs only count through that higher bar).
 */
export const bountyOrJob: Verifier<{ min: number; minJobs?: number }> = {
  key: 'bounty_or_job',
  mode: 'auto',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    return { min: positiveInt(o.min, 'min', 1), ...(o.minJobs === undefined ? {} : { minJobs: positiveInt(o.minJobs, 'minJobs') }) }
  },
  async check(ctx, { min, minJobs }) {
    if (!ctx.sources.countActivity) return { status: 'unknown', reason: "Can't check this right now" }
    let bounties: number
    let jobs = 0
    try {
      bounties = await ctx.sources.countActivity('bounty_completed', ctx.discordId, ctx.memberId)
      if (minJobs) jobs = await ctx.sources.countActivity('job_completed', ctx.discordId, ctx.memberId)
    } catch {
      return { status: 'unknown', reason: "Couldn't read your activity right now" }
    }
    if (bounties >= min || (minJobs && jobs >= minJobs)) return { status: 'pass', evidence: { bounties, jobs } }
    return fail(
      `${bounties}/${min} bounties completed${minJobs ? `, ${jobs}/${minJobs} jobs` : ''}`,
      minJobs ? `Complete a bounty, or do ${minJobs} jobs.` : 'Complete a bounty (reward paid).',
      { have: bounties, need: min },
    )
  },
}

export const articlePublished = counting({
  key: 'article_published',
  kind: 'article_published',
  defaultMin: 1,
  noun: 'published articles',
  hint: 'Write an article and publish it.',
})

/** Buddy pairs the member has seen through to completion as the buddy (BuddyPair COMPLETED). */
export const buddyCompleted = counting({
  key: 'buddy_completed',
  kind: 'buddy_completed',
  defaultMin: 1,
  noun: 'completed buddy pairings',
  hint: 'Be a buddy: get paired with a trainee and help them reach the finishing level.',
})

const SOCIAL_PLATFORMS = ['telegram', 'farcaster'] as const

export const socialLinked: Verifier<{ platforms: string[] }> = {
  key: 'social_linked',
  mode: 'auto',
  stateful: false,
  parse: (p) => {
    const o = asObject(p)
    const platforms = o.platforms === undefined ? [...SOCIAL_PLATFORMS] : stringList(o.platforms, 'platforms').map((s) => s.toLowerCase())
    if (platforms.some((x) => !(SOCIAL_PLATFORMS as readonly string[]).includes(x))) throw new Error('platforms must be "telegram" and/or "farcaster"')
    return { platforms }
  },
  async check(ctx, { platforms }) {
    const linked: string[] = []
    if (platforms.includes('telegram') && (await ctx.sources.getTelegramUsername(ctx.discordId))) linked.push('telegram')
    if (platforms.includes('farcaster') && (await ctx.sources.getFarcasterAccounts(ctx.memberId)).length > 0) linked.push('farcaster')
    if (linked.length) return { status: 'pass', evidence: { linked } }
    return fail('No Telegram or Farcaster account linked', 'Link Telegram or Farcaster on your profile page.')
  },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACTIVITY_VERIFIERS: Array<Verifier<any>> = [
  buddyCompleted,
  pizzeriaCheckin,
  passportStamps,
  spotlightFeatured,
  shopPurchase,
  bountyOrJob,
  articlePublished,
  socialLinked,
]
