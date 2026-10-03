/**
 * Discord HTTP Interactions dispatch: slash commands, blackjack buttons and
 * /buy autocomplete. Pure apart from the injected economy calls (HandlerDeps),
 * so it is unit-testable without Discord or a DB. The route wires the real
 * implementations in app/api/discord/interactions/route.ts.
 *
 * Every reply sets allowed_mentions: [] so the bot never pings anyone.
 */
import { ApiError } from '../errors/api-errors'
import type { IncomeResult } from '../pep-earn/income'
import type { PeaceResult, RobContext, RobResult } from '../pep-earn/rob'
import type { BlackjackMove, BlackjackStart, BlackjackView } from '../pep-games/blackjack'
import { SLOT_EMOJI, type SlotSymbol } from '../pep-games/slots'
import { EPHEMERAL, InteractionType, ResponseType } from './commands'

type Option = { name: string; type: number; value: unknown; focused?: boolean }

export interface Interaction {
  type: number
  guild_id?: string
  data?: {
    name?: string
    options?: Option[]
    custom_id?: string
    component_type?: number
    resolved?: {
      users?: Record<string, { id: string; username?: string; global_name?: string | null; bot?: boolean }>
      members?: Record<string, { roles?: string[]; joined_at?: string; nick?: string | null }>
    }
  }
  member?: { user?: { id: string; bot?: boolean }; roles?: string[]; joined_at?: string }
  user?: { id: string }
}

type MessageData = {
  content: string
  flags?: number
  allowed_mentions: { parse: string[] }
  components?: unknown[]
}

export interface InteractionResponse {
  type: number
  data?: Partial<MessageData> & { choices?: Array<{ name: string; value: string }> }
}

type Spin<T> = Promise<({ ok: true; bet: number; balance: number; payout: number } & T) | { ok: false; reason: 'cooldown'; readyAt: Date }>

export interface HandlerDeps {
  guildId: string | undefined
  /** Currency label, e.g. the guild's <:pepperoni:...> emoji. */
  currency?: string
  getWallet: (discordId: string) => Promise<number>
  doWork: (discordId: string) => Promise<{ ok: true; amount: number; balance: number; prompt: string } | { ok: false; readyAt: Date }>
  collectIncome: (discordId: string, roleIds: string[]) => Promise<IncomeResult & { unresolved?: string[] }>
  pay: (fromId: string, toId: string, amount: number) => Promise<unknown>
  leaderboard: () => Promise<Array<{ userId: string; balance: number; name?: string | null }>>
  robEnabled: () => boolean
  rob: (robberId: string, victimId: string, ctx: RobContext) => Promise<RobResult>
  getPeace: (discordId: string) => Promise<boolean>
  setPeace: (discordId: string, enable: boolean) => Promise<PeaceResult>
  gamesEnabled: () => boolean
  startBlackjack: (discordId: string, bet: number) => Promise<BlackjackStart>
  blackjackAction: (discordId: string, gameId: string, action: 'hit' | 'stand') => Promise<BlackjackMove>
  roulette: (discordId: string, bet: number, space: string) => Spin<{ landed: number; color: string; space: string; multiplier: number }>
  slots: (discordId: string, bet: number) => Spin<{ reels: string[]; multiplier: number }>
  shopItems: () => Promise<Array<{ id: number; name: string; price: number; quantity: number; description?: string | null }>>
  buy: (discordId: string, itemId: number, quantity: number) => Promise<{ item: string; quantity: number; totalCost: number }>
}

const n = (v: number) => v.toLocaleString('en-US')
const rel = (d: Date) => `<t:${Math.ceil(d.getTime() / 1000)}:R>`
const SNOWFLAKE = /^\d{5,25}$/

function reply(content: string, ephemeral = false, components?: unknown[]): InteractionResponse {
  return {
    type: ResponseType.CHANNEL_MESSAGE,
    data: {
      content,
      ...(ephemeral ? { flags: EPHEMERAL } : {}),
      allowed_mentions: { parse: [] },
      ...(components ? { components } : {}),
    },
  }
}

function update(content: string, components: unknown[]): InteractionResponse {
  return { type: ResponseType.UPDATE_MESSAGE, data: { content, allowed_mentions: { parse: [] }, components } }
}

const opt = (i: Interaction, name: string) => i.data?.options?.find((o) => o.name === name)?.value

export async function handleInteraction(i: Interaction, deps: HandlerDeps): Promise<InteractionResponse> {
  if (i.type === InteractionType.PING) return { type: ResponseType.PONG }
  const known: number[] = [InteractionType.APPLICATION_COMMAND, InteractionType.MESSAGE_COMPONENT, InteractionType.AUTOCOMPLETE]
  if (!known.includes(i.type)) return reply('Unsupported interaction.', true)

  if (!deps.guildId || i.guild_id !== deps.guildId) {
    if (i.type === InteractionType.AUTOCOMPLETE) return { type: ResponseType.AUTOCOMPLETE_RESULT, data: { choices: [] } }
    return reply('These commands only work in the PizzaDAO server.', true)
  }
  const userId = i.member?.user?.id ?? i.user?.id
  if (!userId) return reply('Could not identify you.', true)
  const cur = deps.currency ?? '$PEP'

  try {
    if (i.type === InteractionType.AUTOCOMPLETE) return await autocomplete(i, deps)
    if (i.type === InteractionType.MESSAGE_COMPONENT) return await component(i, userId, deps, cur)
    return await command(i, userId, deps, cur)
  } catch (err) {
    // Validation problems (bad amount, insufficient funds, out of stock...) are user errors.
    if (err instanceof ApiError && err.statusCode < 500) return reply(err.message, true)
    throw err
  }
}

async function command(i: Interaction, userId: string, deps: HandlerDeps, cur: string): Promise<InteractionResponse> {
  const pep = (v: number) => `${cur} **${n(v)}**`
  switch (i.data?.name) {
    case 'balance': {
      const target = opt(i, 'member')
      const who = typeof target === 'string' && SNOWFLAKE.test(target) ? target : userId
      const wallet = await deps.getWallet(who)
      return reply(who === userId ? `Your balance: ${pep(wallet)}` : `<@${who}> has ${pep(wallet)}`, true)
    }

    case 'work': {
      const r = await deps.doWork(userId)
      if (!r.ok) return reply(`You're still on your break. You can /work again ${rel(r.readyAt)}.`, true)
      const text = r.prompt.split('{amount}').join(pep(r.amount))
      return reply(`${text}\nBalance: ${cur} ${n(r.balance)}`)
    }

    case 'collect-income': {
      const r = await deps.collectIncome(userId, i.member?.roles ?? [])
      const lines: string[] = []
      for (const p of r.paid) lines.push(`+ ${pep(p.amount)} from **${p.name}**`)
      for (const w of r.waiting) lines.push(`**${w.name}**: next collection ${rel(w.readyAt)}`)
      if (r.paid.length === 0 && r.waiting.length === 0) {
        return reply("None of your roles pay income. Role income comes from roles like Crew Member and Pizza Holder.", true)
      }
      if (r.paid.length === 0) return reply(`Nothing to collect yet.\n${lines.join('\n')}`, true)
      return reply(`<@${userId}> collected ${pep(r.total)} in role income.\n${lines.join('\n')}\nBalance: ${cur} ${n(r.balance)}`)
    }

    case 'pay': {
      const to = opt(i, 'member')
      const amount = opt(i, 'amount')
      if (typeof to !== 'string' || !SNOWFLAKE.test(to)) return reply('Pick a member to pay.', true)
      if (to === userId) return reply("You can't pay yourself.", true)
      if (i.data?.resolved?.users?.[to]?.bot) return reply("You can't pay a bot.", true)
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        return reply('Amount must be a positive whole number.', true)
      }
      await deps.pay(userId, to, amount)
      return reply(`<@${userId}> paid <@${to}> ${pep(amount)}.`)
    }

    case 'leaderboard': {
      const rows = await deps.leaderboard()
      if (rows.length === 0) return reply('Nobody has any $PEP yet.', true)
      const medal = ['🥇', '🥈', '🥉']
      const lines = rows.map((r, idx) => `${medal[idx] ?? `**${idx + 1}.**`} ${r.name ? escapeMd(r.name) : `<@${r.userId}>`}: ${cur} ${n(r.balance)}`)
      return reply(`**$PEP leaderboard**\n${lines.join('\n')}`)
    }

    case 'rob': {
      if (!deps.robEnabled()) return reply("Robbing isn't enabled yet.", true)
      const victim = opt(i, 'member')
      if (typeof victim !== 'string' || !SNOWFLAKE.test(victim)) return reply('Pick a member to rob.', true)
      const resolvedMember = i.data?.resolved?.members?.[victim]
      if (victim !== userId && !resolvedMember) return reply("They're not in the server.", true)
      const r = await deps.rob(userId, victim, {
        victimIsBot: !!i.data?.resolved?.users?.[victim]?.bot,
        robberJoinedAt: i.member?.joined_at ? new Date(i.member.joined_at) : null,
        victimJoinedAt: resolvedMember?.joined_at ? new Date(resolvedMember.joined_at) : null,
      })
      if (!r.ok) return reply(robRefusal(r, victim, cur), true)
      if (r.outcome === 'success') {
        return reply(`💰 <@${userId}> robbed <@${victim}> and got away with ${pep(r.amount)} (${r.percent}% of their wallet).`)
      }
      return reply(`🚨 <@${userId}> got caught trying to rob <@${victim}> and paid them a ${pep(r.amount)} fine.`)
    }

    case 'peace': {
      if (!deps.robEnabled()) return reply("Robbing isn't enabled yet, so there's nothing to opt out of.", true)
      const want = opt(i, 'enabled')
      if (typeof want !== 'boolean') {
        const on = await deps.getPeace(userId)
        return reply(on ? "🕊️ Peace mode is **on**: you can't rob or be robbed." : '⚔️ Peace mode is **off**: you can rob and be robbed.', true)
      }
      const r = await deps.setPeace(userId, want)
      if (!r.ok) {
        return reply(
          r.reason === 'robbed_recently'
            ? `You tried a robbery recently. You can turn on peace mode ${rel(r.readyAt)}.`
            : `You changed peace mode recently. You can change it again ${rel(r.readyAt)}.`,
          true,
        )
      }
      if (!r.changed) return reply(`Peace mode is already ${want ? 'on' : 'off'}.`, true)
      return reply(want ? "🕊️ Peace mode is now **on**. You can't rob or be robbed." : '⚔️ Peace mode is now **off**.', true)
    }

    case 'blackjack': {
      if (!deps.gamesEnabled()) return reply("Games aren't enabled yet.", true)
      const r = await deps.startBlackjack(userId, Number(opt(i, 'bet')))
      if (!r.ok && r.reason === 'cooldown') return reply(`Slow down. You can play again ${rel(r.readyAt)}.`, true)
      if (!r.ok) return reply('You already have a hand in play:\n' + renderBlackjack(r.game, cur), true, blackjackButtons(r.game))
      return reply(renderBlackjack(r.game, cur, r.balance, userId), false, blackjackButtons(r.game))
    }

    case 'roulette': {
      if (!deps.gamesEnabled()) return reply("Games aren't enabled yet.", true)
      const r = await deps.roulette(userId, Number(opt(i, 'bet')), String(opt(i, 'space') ?? ''))
      if (!r.ok) return reply(`Slow down. You can play again ${rel(r.readyAt)}.`, true)
      const dot = r.color === 'red' ? '🔴' : r.color === 'black' ? '⚫' : '🟢'
      const head = `🎡 <@${userId}> bet ${pep(r.bet)} on **${r.space}**. The ball lands on ${dot} **${r.landed}**.`
      const tail = r.payout > 0 ? `You win ${pep(r.payout)} (${r.multiplier}x)!` : 'You lose.'
      return reply(`${head}\n${tail}\nBalance: ${cur} ${n(r.balance)}`)
    }

    case 'slots': {
      if (!deps.gamesEnabled()) return reply("Games aren't enabled yet.", true)
      const r = await deps.slots(userId, Number(opt(i, 'bet')))
      if (!r.ok) return reply(`Slow down. You can play again ${rel(r.readyAt)}.`, true)
      const reels = r.reels.map((s) => SLOT_EMOJI[s as SlotSymbol] ?? s).join(' | ')
      const tail =
        r.multiplier > 1 ? `You win ${pep(r.payout)} (${r.multiplier}x)!` : r.multiplier === 1 ? 'Stake back.' : 'No luck.'
      return reply(`🎰 <@${userId}> bet ${pep(r.bet)}\n[ ${reels} ]\n${tail}\nBalance: ${cur} ${n(r.balance)}`)
    }

    case 'shop': {
      const items = await deps.shopItems()
      if (items.length === 0) return reply('The shop is empty right now.', true)
      const lines = items.map(
        (it) => `**${escapeMd(it.name)}**: ${cur} ${n(it.price)}${it.quantity === -1 ? '' : it.quantity > 0 ? ` (${n(it.quantity)} left)` : ' (sold out)'}`,
      )
      return reply(`**$PEP shop**\n${lines.join('\n')}\nBuy with /buy, or at [app.pizzadao.org/pep](<https://app.pizzadao.org/pep>)`, true)
    }

    case 'buy': {
      const raw = String(opt(i, 'item') ?? '').trim()
      const qtyRaw = opt(i, 'quantity')
      const quantity = qtyRaw === undefined ? 1 : Number(qtyRaw)
      if (!Number.isInteger(quantity) || quantity <= 0) return reply('Quantity must be a positive whole number.', true)
      const items = await deps.shopItems()
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const item = items.find((it) => String(it.id) === raw) ?? items.find((it) => norm(it.name) === norm(raw))
      if (!item) return reply(`No shop item called "${raw}". See /shop.`, true)
      const r = await deps.buy(userId, item.id, quantity)
      return reply(`🛍️ You bought ${r.quantity}x **${escapeMd(r.item)}** for ${pep(r.totalCost)}.`, true)
    }

    default:
      return reply('Unknown command.', true)
  }
}

async function component(i: Interaction, userId: string, deps: HandlerDeps, cur: string): Promise<InteractionResponse> {
  const m = /^bj:(hit|stand):([a-z0-9]{10,40})$/.exec(i.data?.custom_id ?? '')
  if (!m) return reply('Unknown button.', true)
  if (!deps.gamesEnabled()) return reply("Games aren't enabled right now.", true)
  const r = await deps.blackjackAction(userId, m[2], m[1] as 'hit' | 'stand')
  if (!r.ok) return reply(r.reason === 'not_yours' ? "That's not your hand. Start your own with /blackjack." : 'That hand is gone.', true)
  return update(renderBlackjack(r.game, cur, r.balance, userId), blackjackButtons(r.game))
}

async function autocomplete(i: Interaction, deps: HandlerDeps): Promise<InteractionResponse> {
  const focused = i.data?.options?.find((o) => o.focused)
  let choices: Array<{ name: string; value: string }> = []
  if (i.data?.name === 'buy' && focused?.name === 'item') {
    const q = String(focused.value ?? '').toLowerCase()
    const items = await deps.shopItems()
    choices = items
      .filter((it) => it.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((it) => ({ name: `${it.name} (${n(it.price)})`.slice(0, 100), value: String(it.id) }))
  }
  return { type: ResponseType.AUTOCOMPLETE_RESULT, data: { choices } }
}

function robRefusal(r: Extract<RobResult, { ok: false }>, victim: string, cur: string): string {
  switch (r.reason) {
    case 'disabled':
      return "Robbing isn't enabled yet."
    case 'self':
      return "You can't rob yourself."
    case 'bot':
      return "You can't rob a bot."
    case 'robber_new':
      return `New members can't rob yet. You can ${r.readyAt ? rel(r.readyAt) : 'soon'}.`
    case 'victim_new':
      return `<@${victim}> is a new member and is protected for now.`
    case 'robber_peace':
      return "You're in peace mode. Turn it off with /peace enabled:False to rob."
    case 'victim_peace':
      return `<@${victim}> is in peace mode and can't be robbed.`
    case 'peace_recent':
      return `You changed peace mode recently. You can rob ${r.readyAt ? rel(r.readyAt) : 'later'}.`
    case 'robber_poor':
      return `You need at least ${cur} ${n(r.min ?? 0)} in your wallet to rob (you risk a fine).`
    case 'victim_poor':
      return `<@${victim}> has less than ${cur} ${n(r.min ?? 0)}. Not worth it.`
    case 'cooldown':
      return `You're laying low. You can rob again ${r.readyAt ? rel(r.readyAt) : 'later'}.`
    case 'victim_cooldown':
      return `<@${victim}> was targeted recently. They can be robbed again ${r.readyAt ? rel(r.readyAt) : 'later'}.`
  }
}

// ------------------------------------------------------------- blackjack ---

const SUIT: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
export const cardLabel = (c: string) => (c === '??' ? '🂠' : `${c[0] === 'T' ? '10' : c[0]}${SUIT[c[1]] ?? ''}`)

const OUTCOME_TEXT: Record<string, string> = {
  blackjack: 'Blackjack! You win',
  win: 'You win',
  dealer_bust: 'Dealer busts. You win',
  push: 'Push. Your stake comes back:',
  lose: 'Dealer wins.',
  bust: 'Bust! Dealer wins.',
  dealer_blackjack: 'Dealer has blackjack.',
}

export function renderBlackjack(g: BlackjackView, cur: string, balance?: number, userId?: string): string {
  const who = userId ? `<@${userId}>'s ` : ''
  const lines = [
    `🃏 ${who}**Blackjack**, bet ${cur} **${n(g.bet)}**`,
    `You: ${g.player.map(cardLabel).join(' ')} (**${g.playerTotal}**)`,
    `Dealer: ${g.dealer.map(cardLabel).join(' ')}${g.dealerTotal != null ? ` (**${g.dealerTotal}**)` : ''}`,
  ]
  if (g.status === 'SETTLED') {
    const text = OUTCOME_TEXT[g.outcome ?? ''] ?? 'Settled.'
    lines.push(`${g.autoStood ? '⏱️ Timed out, auto-stood. ' : ''}${text}${g.payout ? ` ${cur} **${n(g.payout)}**` : ''}`)
    if (balance !== undefined) lines.push(`Balance: ${cur} ${n(balance)}`)
  } else {
    lines.push(`Hit or stand? Auto-stands <t:${Math.ceil(new Date(g.expiresAt).getTime() / 1000)}:R>.`)
  }
  return lines.join('\n')
}

export function blackjackButtons(g: BlackjackView): unknown[] {
  if (g.status !== 'ACTIVE') return []
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Hit', custom_id: `bj:hit:${g.id}` },
        { type: 2, style: 2, label: 'Stand', custom_id: `bj:stand:${g.id}` },
      ],
    },
  ]
}

function escapeMd(s: string): string {
  return s.replace(/([*_`~|>\\])/g, '\\$1').replace(/@/g, '@\u200b')
}
