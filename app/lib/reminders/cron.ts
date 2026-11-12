/**
 * The whole reminders run for the cron route: calls first (time-critical), then proposals with whatever is
 * left of the shared per-run budget, then the sweep of reminder rows for proposals that are no longer open.
 * Each part has its own switch (reminders.callsEnabled, reminders.proposalsEnabled; env off always wins) and
 * previews never send. Counts only.
 */
import { SITE_URL } from '@/app/lib/site-url'
import { proposalsEnabled } from '@/app/lib/proposals/constants'
import { loadPilotState } from '@/app/lib/proposals/pilot'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { sendDiscordDm } from '@/app/lib/followups/discord-dm'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { reminderSendAllowed } from './deliver'
import { clearSettledProposalReminders, prismaProposalStore } from './proposal-store'
import { runProposalReminders, type ProposalRunResult } from './proposals'
import { loadDmReach, recordDmClosed, recordDmOk } from './reach'
import { runCallRemindersNow, type RunResult } from './run'
import { prismaStore } from './store'

export type Skipped = { skipped: string }
export interface RemindersRunResult {
  calls: RunResult | Skipped
  proposals: ProposalRunResult | Skipped
}

export async function runProposalRemindersNow(
  now: Date,
  env: Record<string, string | undefined>,
  opts: { dryRun?: boolean; callsSent: number },
): Promise<ProposalRunResult | Skipped> {
  // Preview check first: a preview never reads settings or the database.
  const live = reminderSendAllowed(env) && (await toggleEnabled('reminders.proposalsEnabled', env))
  if (!live && !opts.dryRun) return { skipped: 'disabled' }
  const settings = await loadSettings()
  const budget = settings.get('reminders.maxSendsPerRun') - opts.callsSent
  if (budget <= 0) return { skipped: 'budget' }
  return runProposalReminders({
    now,
    env,
    config: {
      enabled: live && !opts.dryRun,
      closingHours: settings.get('reminders.proposalClosingHours'),
      maxSends: budget,
      maxPerMemberPerDay: settings.get('reminders.maxPerMemberPerDay'),
    },
    // Fails closed: unreadable settings mean off, and an unreadable pilot list means a pilot with nobody allowed.
    proposalsOn: await proposalsEnabled(env as NodeJS.ProcessEnv).catch(() => false),
    pilot: await loadPilotState(),
    siteUrl: SITE_URL,
    store: { ...prismaStore, ...prismaProposalStore },
    getReach: loadDmReach,
    setClosed: recordDmClosed,
    setOk: recordDmOk,
    send: (id, text, o) => sendDiscordDm(id, text, o),
    settingsUrl: async (discordId) => {
      const memberId = await fetchMemberIdByDiscordId(discordId)
      return memberId ? `${SITE_URL}/profile/${encodeURIComponent(memberId)}/edit` : null
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
}

export async function runRemindersNow(
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
  opts: { dryRun?: boolean } = {},
): Promise<RemindersRunResult> {
  const calls = await runCallRemindersNow(now, env, opts)
  let proposals: ProposalRunResult | Skipped
  const callsSent = 'sent' in calls ? calls.sent : 0
  if ('stoppedEarly' in calls && calls.stoppedEarly) {
    // The budget is spent or Discord is rate limiting: proposals wait for the next run.
    proposals = { skipped: 'calls_first' }
  } else {
    proposals = await runProposalRemindersNow(now, env, { dryRun: opts.dryRun, callsSent })
  }
  // Privacy sweep: no per-member proposal reminder row outlives its proposal being open. Runs even with the
  // switches off, so rows from an earlier run are still removed. Best effort.
  if (reminderSendAllowed(env)) await clearSettledProposalReminders().catch(() => 0)
  return { calls, proposals }
}
