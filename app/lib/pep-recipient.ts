// Resolve the recipient of a $PEP / item transfer to a Discord ID.
//
// Balances are keyed by Discord ID, but the send forms (SendPepModal and the
// /pep page) ask for a "Member ID" — the PizzaDAO member number from the crew
// sheet. The transfer APIs used to treat whatever was typed as a Discord ID and
// auto-create a wallet for it, so sending to a member number (or a typo) moved
// PEP into a wallet nobody can log into: silently burned.
//
// Accepted input:
//   * a PizzaDAO member ID (1-16 digits) -> that member's Discord ID from the sheet
//   * a Discord ID (17-20 digit snowflake) that belongs to a known member
//     (has a User row here, or is on the members sheet)
// Anything else is rejected before any money moves.
import { prisma } from './db'
import { ValidationError } from './errors/api-errors'
import { getSheetData } from './sheets/member-repository'

const DISCORD_ID = /^\d{17,20}$/
const MEMBER_ID = /^\d{1,16}$/

export async function resolvePepRecipient(raw: unknown): Promise<string> {
  const input = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
  if (!input) throw new ValidationError('Recipient required')

  if (DISCORD_ID.test(input)) {
    const user = await prisma.user.findUnique({ where: { id: input }, select: { id: true } })
    if (user) return input
    const sheet = await getSheetData().catch(() => null)
    if (sheet?.discordToMember.has(input)) return input
    throw new ValidationError('No PizzaDAO member found with that Discord ID')
  }

  if (MEMBER_ID.test(input)) {
    const sheet = await getSheetData().catch(() => null)
    if (!sheet) throw new ValidationError('Could not look up that member right now. Try again shortly.')
    const idx = sheet.memberToIdx.get(input)
    const discordId = idx === undefined ? undefined : String(sheet.rows[idx]?.discordId ?? '').trim()
    if (idx === undefined) throw new ValidationError('No PizzaDAO member found with that member ID')
    if (!discordId || !DISCORD_ID.test(discordId)) {
      throw new ValidationError('That member has not linked Discord yet, so they cannot receive PEP')
    }
    return discordId
  }

  throw new ValidationError('Recipient must be a PizzaDAO member ID or Discord ID')
}
