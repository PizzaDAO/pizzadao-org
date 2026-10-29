/**
 * Who may submit a proposal: a member who holds a Rare Pizzas Box right now (live check, same helper as voting
 * eligibility). A person without a box asks a holder to submit for them and names the holder as sponsor.
 * Fails closed: a lookup error is "no".
 */
import { checkRarePizzaBox } from '@/app/lib/rare-pizza-box'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'

export async function canSubmitProposal(discordId: string): Promise<boolean> {
  try {
    const member = await fetchMemberByDiscordId(discordId)
    if (!member?.memberId) return false
    return (await checkRarePizzaBox(member.memberId)) === 'yes'
  } catch {
    return false
  }
}
