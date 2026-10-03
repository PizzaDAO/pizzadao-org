/**
 * Slash-command dispatch for Discord HTTP Interactions. Pure apart from the
 * injected economy calls, so it is unit-testable without Discord or a DB.
 */
import { EPHEMERAL, InteractionType, ResponseType } from './commands'

export interface Interaction {
  type: number
  guild_id?: string
  data?: {
    name?: string
    options?: Array<{ name: string; type: number; value: unknown }>
  }
  member?: { user?: { id: string } }
  user?: { id: string }
}

export interface InteractionResponse {
  type: number
  data?: { content: string; flags?: number; allowed_mentions: { parse: string[] } }
}

export interface HandlerDeps {
  guildId: string | undefined
  getWallet: (discordId: string) => Promise<number>
  doWork: (discordId: string) => Promise<{ ok: true; amount: number; balance: number; prompt: string } | { ok: false; readyAt: Date }>
  /** Currency label, e.g. the guild's <:pepperoni:...> emoji. */
  currency?: string
}

const n = (v: number) => v.toLocaleString('en-US')

function reply(content: string, ephemeral = false): InteractionResponse {
  // Never ping anyone from a bot reply.
  return {
    type: ResponseType.CHANNEL_MESSAGE,
    data: { content, ...(ephemeral ? { flags: EPHEMERAL } : {}), allowed_mentions: { parse: [] } },
  }
}

export async function handleInteraction(i: Interaction, deps: HandlerDeps): Promise<InteractionResponse> {
  if (i.type === InteractionType.PING) return { type: ResponseType.PONG }
  if (i.type !== InteractionType.APPLICATION_COMMAND) return reply('Unsupported interaction.', true)

  if (!deps.guildId || i.guild_id !== deps.guildId) return reply('These commands only work in the PizzaDAO server.', true)
  const userId = i.member?.user?.id ?? i.user?.id
  if (!userId) return reply('Could not identify you.', true)
  const cur = deps.currency ?? '$PEP'

  switch (i.data?.name) {
    case 'balance': {
      const target = i.data.options?.find((o) => o.name === 'member')?.value
      const who = typeof target === 'string' && /^\d{5,25}$/.test(target) ? target : userId
      const wallet = await deps.getWallet(who)
      return reply(who === userId ? `Your balance: ${cur} **${n(wallet)}**` : `<@${who}> has ${cur} **${n(wallet)}**`, true)
    }
    case 'work': {
      const r = await deps.doWork(userId)
      if (!r.ok) {
        return reply(`You're still on your break. You can /work again <t:${Math.ceil(r.readyAt.getTime() / 1000)}:R>.`, true)
      }
      const text = r.prompt.split('{amount}').join(`${cur} **${n(r.amount)}**`)
      return reply(`${text}\nBalance: ${cur} ${n(r.balance)}`)
    }
    default:
      return reply('Unknown command.', true)
  }
}
