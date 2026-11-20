/**
 * /trivia suggest opens a modal (type 9) instead of deferring; its submit is handled in handle.ts with the helpers at
 * the bottom of this file (modal, parsing, reply text).
 *
 * /trivia leaderboard | start | skip: the deferred half. The interaction handler answers within Discord's 3 s window
 * with a deferred reply (type 5; ephemeral unless the leaderboard was asked for publicly); this runs afterwards
 * (route: after()) and edits the reply in via the interaction webhook. start and skip are admin only (checked by
 * the handler before anything is deferred). Dependencies are injected so tests never reach Discord or the database.
 * See plans/trivia.md sections 6 and 9.
 *
 * The questions and answers never appear in a reply: start only says a round began (the question is posted in the
 * trivia channel by the bot), skip only says a round was cancelled.
 */
import { makeEmbed, type Embed, type EmbedAuthor } from './embeds'
import { esc } from './text'

const API = 'https://discord.com/api/v10'

export const TRIVIA_SUBCOMMANDS = ['leaderboard', 'start', 'skip', 'report', 'suggest'] as const
export type TriviaSub = (typeof TRIVIA_SUBCOMMANDS)[number]
/** The subcommands that defer and edit the reply (everything except /trivia suggest, which opens a modal). */
export type TriviaDeferredSub = Exclude<TriviaSub, 'suggest'>
export const TRIVIA_ADMIN_SUBCOMMANDS: readonly TriviaSub[] = ['start', 'skip']

export interface TriviaJob {
  sub: TriviaDeferredSub
  discordId: string
  /** leaderboard: show it to the channel instead of only to the member. */
  public?: boolean
  /** report: why the question is bad (optional, already cleaned). */
  reason?: string
  applicationId: string
  token: string
  author?: EmbedAuthor
}

export interface LeaderboardRow {
  rank: number
  name: string
  score: number
}

export type StartOutcome =
  | { status: 'started'; channelId: string }
  | { status: 'no_channel' | 'open_exists' | 'no_question' | 'busy' | 'post_failed' }

export type ReportLatestResult =
  | { status: 'reported'; question: string }
  | { status: 'duplicate'; question: string }
  | { status: 'none' }
  | { status: 'not_member' }

export interface TriviaCommandDeps {
  /** Top winners, this month and all time. Names only, never ids. */
  leaderboard: () => Promise<{ available: boolean; month: LeaderboardRow[]; allTime: LeaderboardRow[] }>
  startRound: () => Promise<StartOutcome>
  /** Cancel the open round. `no_channel` when no channel is configured. */
  skipRound: () => Promise<'cancelled' | 'none_open' | 'no_channel'>
  /** Report the most recent round's question for this member. `question` is the question text (shortened here). */
  reportLatest: (discordId: string, reason: string | undefined) => Promise<ReportLatestResult>
  fetchImpl?: typeof fetch
}

/** The question, cut to about 60 characters for the confirmation. */
const shortQuestion = (q: string): string => (q.length > 60 ? `${q.slice(0, 59).trimEnd()}…` : q)

const rows = (list: LeaderboardRow[]): string =>
  list.length === 0 ? 'No wins yet.' : list.slice(0, 10).map((r) => `${r.rank}. ${esc(r.name)}: ${r.score} win${r.score === 1 ? '' : 's'}`).join('\n')

export async function buildTriviaReply(job: TriviaJob, deps: TriviaCommandDeps): Promise<Embed> {
  const author = job.author
  switch (job.sub) {
    case 'leaderboard': {
      const lb = await deps.leaderboard()
      if (!lb.available) return makeEmbed('error', 'The trivia leaderboard is not available right now.', undefined, { author })
      return makeEmbed('success', 'Trivia leaderboard', undefined, {
        author,
        fields: [
          { name: 'This month', value: rows(lb.month), inline: true },
          { name: 'All time', value: rows(lb.allTime), inline: true },
        ],
      })
    }
    case 'start': {
      const r = await deps.startRound()
      if (r.status === 'started') return makeEmbed('success', 'Round started.', `The question was posted in <#${r.channelId}>.`, { author })
      const why: Record<Exclude<StartOutcome['status'], 'started'>, string> = {
        no_channel: 'No trivia channel is set. Set `trivia.channelId` in the admin settings.',
        open_exists: 'A round is already open. Wait for it to finish, or use `/trivia skip`.',
        no_question: 'There is no question left to ask (every approved Discord question is disabled or retired).',
        busy: 'Another round is being opened right now. Try again in a moment.',
        post_failed: 'Discord refused the post, so no round was opened. Check the bot can post in the channel.',
      }
      return makeEmbed('error', "Couldn't start a round.", why[r.status], { author })
    }
    case 'report': {
      const r = await deps.reportLatest(job.discordId, job.reason)
      if (r.status === 'none') return makeEmbed('error', 'There is no trivia question to report yet.', undefined, { author })
      if (r.status === 'not_member') return makeEmbed('error', 'Only PizzaDAO members on an account at least 7 days old can report questions.', undefined, { author })
      const q = esc(shortQuestion(r.question))
      if (r.status === 'duplicate') return makeEmbed('success', `You already reported '${q}'. Thanks!`, undefined, { author })
      return makeEmbed('success', `Thanks, reported '${q}'.`, undefined, { author })
    }
    case 'skip': {
      const r = await deps.skipRound()
      if (r === 'cancelled') return makeEmbed('success', 'Round cancelled. No $PEP was paid.', undefined, { author })
      if (r === 'no_channel') return makeEmbed('error', 'No trivia channel is set.', undefined, { author })
      return makeEmbed('error', 'There is no open round to skip.', undefined, { author })
    }
  }
}

async function editOriginal(job: TriviaJob, embed: Embed, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(`${API}/webhooks/${encodeURIComponent(job.applicationId)}/${encodeURIComponent(job.token)}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} editing the /trivia reply`)
}

/** Build the reply and edit the deferred message. Never throws. */
export async function runTriviaCommand(job: TriviaJob, deps: TriviaCommandDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    await editOriginal(job, await buildTriviaReply(job, deps), fetchImpl)
  } catch (err) {
    console.error(`[/trivia ${job.sub}] failed:`, err instanceof Error ? err.message : String(err))
    try {
      await editOriginal(job, makeEmbed('error', 'Something went wrong. Please try again.', undefined, { author: job.author }), fetchImpl)
    } catch {
      // the token may have expired; nothing more to do
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// /trivia suggest: the modal, its parsing and the replies (plans/trivia.md section 10, phase 3)
// ---------------------------------------------------------------------------------------------------------------

export const TRIVIA_SUGGEST_MODAL_ID = 'trivia:suggest'
const IN_QUESTION = 'question'
const IN_ANSWER = 'answer'
const IN_ALIASES = 'aliases'
const IN_SOURCE = 'source'
const IN_CATEGORY = 'category'

/** The Discord modal (response type 9 data): question, answer, optional aliases, source link, optional category. */
export function triviaSuggestModal() {
  const row = (custom_id: string, label: string, extra: Record<string, unknown>) => ({
    type: 1,
    components: [{ type: 4, custom_id, label, ...extra }],
  })
  return {
    custom_id: TRIVIA_SUGGEST_MODAL_ID,
    title: 'Suggest a trivia question',
    components: [
      row(IN_QUESTION, 'Question', { style: 2, min_length: 8, max_length: 300, required: true, placeholder: 'One fact, worded so it has one right answer' }),
      row(IN_ANSWER, 'Answer', { style: 1, max_length: 120, required: true, placeholder: 'True / False, a number or a short answer' }),
      row(IN_ALIASES, 'Other accepted answers (optional)', { style: 1, max_length: 400, required: false, placeholder: 'Separate with commas' }),
      row(IN_SOURCE, 'Source link (http or https)', { style: 1, max_length: 300, required: true, placeholder: 'https://...' }),
      row(IN_CATEGORY, 'Category (optional)', { style: 1, max_length: 40, required: false, placeholder: 'pizza-day, jercos, early-bitcoin, satoshi, protocol, myth-busting, pizzadao' }),
    ],
  }
}

/** The text-input values of a submitted modal, by field. Missing inputs are empty strings. */
export function readTriviaSuggestModal(components: Array<{ components?: Array<{ custom_id?: string; value?: string }> }> | undefined) {
  const flat = (components ?? []).flatMap((r) => r.components ?? [])
  const get = (id: string) => flat.find((c) => c.custom_id === id)?.value ?? ''
  return { question: get(IN_QUESTION), answer: get(IN_ANSWER), aliases: get(IN_ALIASES), source: get(IN_SOURCE), category: get(IN_CATEGORY) }
}

export type SuggestResult = { status: 'recorded' } | { status: 'limit' } | { status: 'invalid'; field: string } | { status: 'error' }

/** What to tell the member after the modal: [tone, headline, body]. */
export function triviaSuggestReply(r: SuggestResult, perDay: number): ['success' | 'error' | 'cooldown', string, string | undefined] {
  switch (r.status) {
    case 'recorded':
      return ['success', 'Thanks, your question was sent to the team.', "They'll check the source before anything is asked. Suggestions are never shown until approved."]
    case 'limit':
      return ['cooldown', `You can suggest ${perDay} questions a day.`, 'Try again tomorrow.']
    case 'invalid': {
      const why: Record<string, string> = {
        question: 'The question must be 8 to 300 characters.',
        answer: 'The answer must be 1 to 120 characters.',
        aliases: 'Up to 8 other answers, each up to 80 characters.',
        source: 'The source must be a full http or https link.',
        category: 'Category must be one of: pizza-day, jercos, early-bitcoin, satoshi, protocol, myth-busting, pizzadao, just-for-fun (or leave it empty).',
      }
      return ['error', "That didn't work.", why[r.field] ?? 'Please check the form and try again.']
    }
    case 'error':
      return ['error', 'Something went wrong. Please try again.', undefined]
  }
}
