/**
 * Pilot mode (plans/voting-golive-and-reminders.md H6). While `proposals.pilotDiscordIds` holds anyone:
 *  - only the listed members see the voting UI, can submit and can get ballot tokens;
 *  - the voter snapshot of a proposal is limited to them;
 *  - the payments gate stays OFF (a payment request behaves as if proposals were off);
 *  - proposals submitted are marked `isTest`: short window, threshold 1, kept out of lists, totals and funding.
 * Clearing the list (with proposals.enabled on) is the real go-live.
 */
import { loadSettings } from '@/app/lib/settings'
import { proposalsEnabled } from './constants'

/** The pilot list. Unreadable settings give an empty list; the switch itself already fails closed. */
export async function loadPilotIds(): Promise<string[]> {
  try {
    return [...(await loadSettings()).get('proposals.pilotDiscordIds')]
  } catch {
    return []
  }
}

/** Pure. The viewer may use the voting feature while it is on: everyone when no pilot is set, else only the listed members. */
export function pilotAllows(pilot: readonly string[], discordId: string | null | undefined): boolean {
  return pilot.length === 0 || (!!discordId && pilot.includes(discordId))
}

/** Voting is on for this member: the switch is on and, during a pilot, the member is listed. Fails closed. */
export async function proposalsEnabledFor(discordId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!(await proposalsEnabled(env).catch(() => false))) return false
  return pilotAllows(await loadPilotIds(), discordId)
}
