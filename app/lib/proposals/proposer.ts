/**
 * Who may submit a proposal: a member who holds the voter role (Box Mafia by default) right now (live check).
 * A person without it asks a holder to submit for them and names the holder as sponsor. Fails closed.
 */
import { holdsVoterRole } from './eligibility'

export function canSubmitProposal(discordId: string): Promise<boolean> {
  return holdsVoterRole(discordId)
}
