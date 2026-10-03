/**
 * The deferred half of the /missions slash command. The interaction handler
 * answers within Discord's 3 s window with a deferred, ephemeral reply
 * (type 5); this runs afterwards (route: after()), runs the verifiers with
 * the interaction's fresh `member.roles`, and edits the reply in place:
 *
 *   PATCH /webhooks/{application_id}/{token}/messages/@original
 *
 * Interaction tokens are valid for 15 minutes. Dependencies are injected so
 * tests never reach Discord or the DB.
 */
import type { Embed } from '../discord-interactions/embeds'
import { makeEmbed } from '../discord-interactions/embeds'
import type { MissionsJob } from '../discord-interactions/handle'
import type { RunReport } from './engine'
import { buildMissionsView, renderMissionsEmbed, type MissionsView } from './view'

const API = 'https://discord.com/api/v10'

export interface MissionsCommandDeps {
  /** Whether the member finished onboarding (has a member row). */
  isMember?: (discordId: string) => Promise<boolean>
  run: (discordId: string, roles: string[]) => Promise<RunReport>
  overview: (discordId: string) => Promise<Parameters<typeof buildMissionsView>[0]>
  announce: (view: MissionsView, discordId: string) => Promise<unknown>
  fetchImpl?: typeof fetch
  currency?: string
  appUrl?: string
}

export function editOriginalUrl(applicationId: string, token: string): string {
  return `${API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`
}

async function editOriginal(job: MissionsJob, embed: Embed, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(editOriginalUrl(job.applicationId, job.token), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} editing the /missions reply: ${(await res.text()).slice(0, 200)}`)
}

/** Run the check and edit the deferred reply. Never throws (errors are edited in, then logged). */
export async function runMissionsCommand(job: MissionsJob, deps: MissionsCommandDeps): Promise<MissionsView | null> {
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    if (deps.isMember && !(await deps.isMember(job.discordId))) {
      const where = deps.appUrl ? ` at [${deps.appUrl.replace(/^https?:\/\//, '')}](<${deps.appUrl}>)` : ''
      await editOriginal(job, makeEmbed('error', 'Finish onboarding first.', `Join PizzaDAO${where}, then try /missions again.`, { author: job.author }), fetchImpl)
      return null
    }
    const report = await deps.run(job.discordId, job.roles)
    const view = buildMissionsView(await deps.overview(job.discordId), report)
    await editOriginal(job, renderMissionsEmbed(view, { author: job.author, currency: deps.currency, appUrl: deps.appUrl }), fetchImpl)
    if (!report.dryRun && (report.levelsPaid.length || report.approved.length)) {
      await deps.announce(view, job.discordId).catch((err) => console.error('[/missions] announce failed:', err))
    }
    return view
  } catch (err) {
    console.error('[/missions] check failed:', err)
    try {
      await editOriginal(job, makeEmbed('error', 'Something went wrong checking your missions. Please try again.', undefined, { author: job.author }), fetchImpl)
    } catch (e2) {
      console.error('[/missions] could not edit the reply:', e2)
    }
    return null
  }
}
