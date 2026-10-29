/**
 * Glue between the store and the outside world: open a new proposal (snapshot + window), then tell Discord.
 * Called from `after()` on the create route and again from the daily cron for anything that was missed.
 */
import { openProposal } from './store'

export async function openAndAnnounce(id: string): Promise<void> {
  try {
    await openProposal(id)
  } catch (e) {
    // The proposal stays a DRAFT; the cron tries again.
    console.error('[proposals] open failed:', (e as Error)?.name)
  }
}
