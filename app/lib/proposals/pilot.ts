/**
 * Pilot mode (plans/voting-golive-and-reminders.md H6). While `proposals.pilotDiscordIds` holds anyone and go-live
 * (`proposals.liveSince`) has not been recorded:
 *  - only the listed members see the voting UI, can submit and get ballot tokens;
 *  - the voter snapshot of a proposal is limited to them;
 *  - the payments gate stays OFF (a payment request behaves as if proposals were off);
 *  - proposals submitted are marked `isTest`: short window, threshold 1, kept out of lists, totals and funding.
 * Clearing the list (with proposals.enabled on) is the real go-live. Once liveSince is set the list is ignored.
 */
import { loadSettings } from '@/app/lib/settings'
import { proposalsEnabled } from './constants'
import { NO_PILOT, pilotAllows, pilotStateFrom, type PilotState } from './pilot-state'

export { pilotAllows, type PilotState }

/** The pilot state. Unreadable settings (or an invalid list) mean a pilot is running with an unknown list: fail closed. */
export async function loadPilotState(): Promise<PilotState> {
  try {
    return pilotStateFrom(await loadSettings())
  } catch {
    return { ...NO_PILOT, running: true, unknown: true }
  }
}

/** Voting is on for this member: the switch is on and, during a pilot, the member is listed. Fails closed. */
export async function proposalsEnabledFor(discordId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!(await proposalsEnabled(env).catch(() => false))) return false
  return pilotAllows(await loadPilotState(), discordId)
}
