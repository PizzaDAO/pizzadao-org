/**
 * Discord HTTP Interactions dispatch: slash commands, blackjack buttons and
 * /buy autocomplete. Pure apart from the injected economy calls (HandlerDeps),
 * so it is unit-testable without Discord or a DB. The route wires the real
 * implementations in app/api/discord/interactions/route.ts.
 *
 * Every reply is an UnbelievaBoat-style embed (see ./embeds): green success,
 * red errors/refusals, amber cooldowns; errors and cooldowns are ephemeral.
 * allowed_mentions is { parse: [] } so nothing pings, except the few replies
 * that deliberately ping one member in plain content (/pay's recipient,
 * /add-money and /remove-money's target).
 */
import { ApiError } from '../errors/api-errors'
import { adminGrantError, normalizeReason, type AdminAdjustResult } from '../pep-admin'
import type { IncomeResult } from '../pep-earn/income'
import type { BlackjackMove, BlackjackStart, BlackjackView } from '../pep-games/blackjack'
import { SLOT_EMOJI, type SlotSymbol } from '../pep-games/slots'
import { EPHEMERAL, InteractionType, ResponseType } from './commands'
import { authorFor, makeEmbed, numbered, roleLabel, type Embed, type EmbedAuthor, type EmbedField, type Tone } from './embeds'

type Option = { name: string; type: number; value: unknown; focused?: boolean }
type DiscordUser = { id: string; username?: string; global_name?: string | null; avatar?: string | null; bot?: boolean }

export interface Interaction {
  type: number
  /** Needed to edit a deferred reply via the interaction webhook. */
  application_id?: string
  token?: string
  guild_id?: string
  data?: {
    name?: string
    options?: Option[]
    custom_id?: string
    component_type?: number
    resolved?: {
      users?: Record<string, DiscordUser>
      members?: Record<string, { roles?: string[]; joined_at?: string; nick?: string | null }>
    }
  }
  member?: { user?: DiscordUser; roles?: string[]; joined_at?: string; nick?: string | null; avatar?: string | null }
  user?: DiscordUser
}

type AllowedMentions = { parse: string[]; users?: string[] }

type MessageData = {
  content?: string
  embeds?: Embed[]
  flags?: number
  allowed_mentions: AllowedMentions
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
  leaderboard: () => Promise<Array<{ userId: string; balance: number }>>
  gamesEnabled: () => boolean
  startBlackjack: (discordId: string, bet: number) => Promise<BlackjackStart>
  blackjackAction: (discordId: string, gameId: string, action: 'hit' | 'stand') => Promise<BlackjackMove>
  roulette: (discordId: string, bet: number, space: string) => Spin<{ landed: number; color: string; space: string; multiplier: number }>
  slots: (discordId: string, bet: number) => Spin<{ reels: string[]; multiplier: number }>
  shopItems: () => Promise<Array<{ id: number; name: string; price: number; quantity: number; description?: string | null }>>
  buy: (discordId: string, itemId: number, quantity: number) => Promise<{ item: string; quantity: number; totalCost: number }>
  /** Whether member.roles may run /add-money and /remove-money (ADMIN_ROLE_IDS, Pepperoni Mafia, PEP_ADMIN_ROLE_*). */
  isAdmin: (memberRoles: string[]) => Promise<boolean>
  /** Largest single admin grant (ADMIN_GRANT_MAX). */
  adminGrantMax: number
  addMoney: (adminId: string, targetId: string, amount: number, reason: string) => Promise<AdminAdjustResult>
  removeMoney: (adminId: string, targetId: string, amount: number, reason: string) => Promise<AdminAdjustResult>
  /** Optional audit post (PEP_ADMIN_LOG_CHANNEL_ID). Must not throw or block the reply. */
  logAdmin?: (text: string) => void
  /**
   * /missions. `rateLimit` returns when the member may run it again (null =
   * allowed now, and counts this use). `defer` schedules the verifier run and
   * the webhook edit of the deferred reply; it must not block (route: after()).
   */
  missions?: {
    rateLimit: (discordId: string) => Promise<Date | null>
    defer: (job: MissionsJob) => void
  }
}

/** What the deferred /missions follow-up needs. */
export interface MissionsJob {
  discordId: string
  roles: string[]
  applicationId: string
  token: string
  author?: EmbedAuthor
}

const n = (v: number) => v.toLocaleString('en-US')
const rel = (d: Date) => `<t:${Math.ceil(d.getTime() / 1000)}:R>`
const SNOWFLAKE = /^\d{5,25}$/
const NO_PINGS: AllowedMentions = { parse: [] }

/** Builds replies with the invoking member as the embed author. */
class Out {
  constructor(private readonly author: EmbedAuthor | undefined) {}

  embed(tone: Tone, headline: string, body?: string, fields?: EmbedField[]): Embed {
    return makeEmbed(tone, headline, body, { author: this.author, fields })
  }

  /** Public (or ephemeral) message. `ping` puts that user's mention in content and lets it notify them. */
  send(
    tone: Tone,
    headline: string,
    body?: string,
    opts: { ephemeral?: boolean; components?: unknown[]; ping?: string; fields?: EmbedField[] } = {},
  ): InteractionResponse {
    return {
      type: ResponseType.CHANNEL_MESSAGE,
      data: {
        ...(opts.ping ? { content: `<@${opts.ping}>` } : {}),
        embeds: [this.embed(tone, headline, body, opts.fields)],
        ...(opts.ephemeral ? { flags: EPHEMERAL } : {}),
        allowed_mentions: opts.ping ? { parse: [], users: [opts.ping] } : NO_PINGS,
        ...(opts.components ? { components: opts.components } : {}),
      },
    }
  }

  ok(headline: string, body?: string, opts: { ephemeral?: boolean; components?: unknown[]; ping?: string; fields?: EmbedField[] } = {}) {
    return this.send('success', headline, body, opts)
  }

  /** Errors and refusals: red, ephemeral. */
  error(headline: string, body?: string) {
    return this.send('error', headline, body, { ephemeral: true })
  }

  /** Cooldowns: amber, ephemeral. */
  wait(headline: string, body?: string, components?: unknown[]) {
    return this.send('cooldown', headline, body, { ephemeral: true, components })
  }

  update(embed: Embed, components: unknown[]): InteractionResponse {
    return { type: ResponseType.UPDATE_MESSAGE, data: { embeds: [embed], allowed_mentions: NO_PINGS, components } }
  }
}

const opt = (i: Interaction, name: string) => i.data?.options?.find((o) => o.name === name)?.value

export async function handleInteraction(i: Interaction, deps: HandlerDeps): Promise<InteractionResponse> {
  if (i.type === InteractionType.PING) return { type: ResponseType.PONG }
  const out = new Out(authorFor(i.member ? { ...i.member, guildId: i.guild_id } : i.user ? { user: i.user } : undefined))
  const known: number[] = [InteractionType.APPLICATION_COMMAND, InteractionType.MESSAGE_COMPONENT, InteractionType.AUTOCOMPLETE]
  if (!known.includes(i.type)) return out.error('Unsupported interaction.')

  if (!deps.guildId || i.guild_id !== deps.guildId) {
    if (i.type === InteractionType.AUTOCOMPLETE) return { type: ResponseType.AUTOCOMPLETE_RESULT, data: { choices: [] } }
    return out.error('These commands only work in the PizzaDAO server.')
  }
  const userId = i.member?.user?.id ?? i.user?.id
  if (!userId) return out.error('Could not identify you.')
  const cur = deps.currency ?? '$PEP'

  try {
    if (i.type === InteractionType.AUTOCOMPLETE) return await autocomplete(i, deps)
    if (i.type === InteractionType.MESSAGE_COMPONENT) return await component(i, userId, deps, cur, out)
    return await command(i, userId, deps, cur, out)
  } catch (err) {
    // Validation problems (bad amount, insufficient funds, out of stock...) are user errors.
    if (err instanceof ApiError && err.statusCode < 500) return out.error(err.message)
    throw err
  }
}

async function command(i: Interaction, userId: string, deps: HandlerDeps, cur: string, out: Out): Promise<InteractionResponse> {
  const pep = (v: number) => `${cur} **${n(v)}**`
  const amt = (v: number) => `${cur} ${n(v)}`
  switch (i.data?.name) {
    case 'balance': {
      const target = opt(i, 'member')
      const who = typeof target === 'string' && SNOWFLAKE.test(target) ? target : userId
      const wallet = await deps.getWallet(who)
      return out.ok(who === userId ? 'Your balance' : `Balance of <@${who}>`, undefined, {
        ephemeral: true,
        fields: [{ name: 'Wallet', value: amt(wallet), inline: true }],
      })
    }

    case 'work': {
      const r = await deps.doWork(userId)
      if (!r.ok) return out.wait("You're still on your break.", `You can /work again ${rel(r.readyAt)}.`)
      const text = r.prompt.split('{amount}').join(pep(r.amount))
      return out.ok('Shift complete!', `${text}\n\nEarned: ${amt(r.amount)} • Balance: ${amt(r.balance)}`)
    }

    case 'collect-income': {
      const r = await deps.collectIncome(userId, i.member?.roles ?? [])
      if (r.paid.length === 0 && r.waiting.length === 0) {
        return out.error("None of your roles pay income.", 'Role income comes from roles like Crew Member and Pizza Holder.')
      }
      const waiting = r.waiting.map((w) => `${roleLabel(w.roleId, w.name)}: next collection ${rel(w.readyAt)}`)
      if (r.paid.length === 0) return out.wait('Nothing to collect yet.', waiting.join('\n'))
      const paid = [...r.paid].sort((a, b) => b.amount - a.amount).map((p) => `${roleLabel(p.roleId, p.name)} ${amt(p.amount)}`)
      const body = [numbered(paid), '', `Total: ${amt(r.total)} • Balance: ${amt(r.balance)}`]
      if (waiting.length) body.push('', ...waiting)
      return out.ok('Role income successfully collected!', body.join('\n'))
    }

    case 'pay': {
      const to = opt(i, 'member')
      const amount = opt(i, 'amount')
      if (typeof to !== 'string' || !SNOWFLAKE.test(to)) return out.error('Pick a member to pay.')
      if (to === userId) return out.error("You can't pay yourself.")
      if (i.data?.resolved?.users?.[to]?.bot) return out.error("You can't pay a bot.")
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        return out.error('Amount must be a positive whole number.')
      }
      await deps.pay(userId, to, amount)
      return out.ok('Payment sent!', `<@${userId}> paid <@${to}> ${pep(amount)}.`, { ping: to })
    }

    case 'leaderboard': {
      const rows = await deps.leaderboard()
      if (rows.length === 0) return out.error('Nobody has any $PEP yet.')
      return out.ok('$PEP leaderboard', numbered(rows.map((r) => `<@${r.userId}> ${amt(r.balance)}`)))
    }

    case 'blackjack': {
      if (!deps.gamesEnabled()) return out.error("Games aren't enabled yet.")
      const r = await deps.startBlackjack(userId, Number(opt(i, 'bet')))
      if (!r.ok && r.reason === 'cooldown') return out.wait('Slow down.', `You can play again ${rel(r.readyAt)}.`)
      if (!r.ok) return out.wait('You already have a hand in play.', renderBlackjack(r.game, cur).lines.join('\n'), blackjackButtons(r.game))
      return {
        type: ResponseType.CHANNEL_MESSAGE,
        data: { embeds: [blackjackEmbed(r.game, cur, out, r.balance, userId)], allowed_mentions: NO_PINGS, components: blackjackButtons(r.game) },
      }
    }

    case 'roulette': {
      if (!deps.gamesEnabled()) return out.error("Games aren't enabled yet.")
      const r = await deps.roulette(userId, Number(opt(i, 'bet')), String(opt(i, 'space') ?? ''))
      if (!r.ok) return out.wait('Slow down.', `You can play again ${rel(r.readyAt)}.`)
      const dot = r.color === 'red' ? '🔴' : r.color === 'black' ? '⚫' : '🟢'
      const body = `🎡 <@${userId}> bet ${pep(r.bet)} on **${r.space}**. The ball lands on ${dot} **${r.landed}**.\n\nBalance: ${amt(r.balance)}`
      return r.payout > 0 ? out.ok(`You win ${pep(r.payout)} (${r.multiplier}x)!`, body) : out.send('error', 'You lose.', body)
    }

    case 'slots': {
      if (!deps.gamesEnabled()) return out.error("Games aren't enabled yet.")
      const r = await deps.slots(userId, Number(opt(i, 'bet')))
      if (!r.ok) return out.wait('Slow down.', `You can play again ${rel(r.readyAt)}.`)
      const reels = r.reels.map((s) => SLOT_EMOJI[s as SlotSymbol] ?? s).join(' | ')
      const body = `🎰 <@${userId}> bet ${pep(r.bet)}\n[ ${reels} ]\n\nBalance: ${amt(r.balance)}`
      if (r.multiplier > 1) return out.ok(`You win ${pep(r.payout)} (${r.multiplier}x)!`, body)
      if (r.multiplier === 1) return out.ok('Stake back.', body)
      return out.send('error', 'No luck.', body)
    }

    case 'shop': {
      const items = await deps.shopItems()
      if (items.length === 0) return out.error('The shop is empty right now.')
      const lines = items.map(
        (it) => `**${escapeMd(it.name)}** ${amt(it.price)}${it.quantity === -1 ? '' : it.quantity > 0 ? ` (${n(it.quantity)} left)` : ' (sold out)'}`,
      )
      return out.ok('$PEP shop', `${numbered(lines)}\n\nBuy with /buy, or at [app.pizzadao.org/pep](<https://app.pizzadao.org/pep>)`, { ephemeral: true })
    }

    case 'buy': {
      const raw = String(opt(i, 'item') ?? '').trim()
      const qtyRaw = opt(i, 'quantity')
      const quantity = qtyRaw === undefined ? 1 : Number(qtyRaw)
      if (!Number.isInteger(quantity) || quantity <= 0) return out.error('Quantity must be a positive whole number.')
      const items = await deps.shopItems()
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const item = items.find((it) => String(it.id) === raw) ?? items.find((it) => norm(it.name) === norm(raw))
      if (!item) return out.error(`No shop item called "${escapeMd(raw)}".`, 'See /shop.')
      const r = await deps.buy(userId, item.id, quantity)
      return out.ok('Purchase complete!', `🛍️ You bought ${r.quantity}x **${escapeMd(r.item)}** for ${pep(r.totalCost)}.`, { ephemeral: true })
    }

    case 'add-money':
    case 'remove-money':
      return adminMoney(i, userId, deps, cur, out, i.data.name === 'add-money')

    case 'missions': {
      if (!deps.missions) return out.error('Missions are not available right now.')
      if (!i.application_id || !i.token) return out.error('Could not start the check. Please try again.')
      const readyAt = await deps.missions.rateLimit(userId)
      if (readyAt) return out.wait('Slow down.', `You can check your missions again ${rel(readyAt)}.`)
      deps.missions.defer({
        discordId: userId,
        roles: i.member?.roles ?? [],
        applicationId: i.application_id,
        token: i.token,
        author: authorFor(i.member ? { ...i.member, guildId: i.guild_id } : undefined),
      })
      // "Pepperoni Bot is thinking..." (ephemeral); the result is edited in.
      return { type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } }
    }

    default:
      return out.error('Unknown command.')
  }
}

/** /add-money and /remove-money. Admin gate first, so non-admins learn nothing else. */
async function adminMoney(i: Interaction, adminId: string, deps: HandlerDeps, cur: string, out: Out, add: boolean): Promise<InteractionResponse> {
  if (!(await deps.isAdmin(i.member?.roles ?? []))) return out.error('Only admins can use this command.')

  const target = opt(i, 'member')
  const amount = opt(i, 'amount')
  const reason = normalizeReason(opt(i, 'reason'))
  if (typeof target !== 'string' || !SNOWFLAKE.test(target)) return out.error('Pick a member.')
  if (i.data?.resolved?.users?.[target]?.bot) return out.error("Bots don't have wallets.")
  if (add && !i.data?.resolved?.members?.[target]) return out.error("They're not in the server.")
  const invalid = adminGrantError(amount, reason, deps.adminGrantMax)
  if (invalid) return out.error(invalid)
  const value = amount as number

  const r = add ? await deps.addMoney(adminId, target, value, reason) : await deps.removeMoney(adminId, target, value, reason)
  const pep = `${cur} **${n(value)}**`
  if (!r.ok) {
    return out.error('Not enough $PEP.', `<@${target}> only has ${cur} **${n(r.balance)}**. Nothing was removed.`)
  }
  const line = add
    ? `<@${adminId}> gave <@${target}> ${pep}: ${escapeMd(reason)}`
    : `<@${adminId}> took ${pep} from <@${target}>: ${escapeMd(reason)}`
  deps.logAdmin?.(`${add ? '➕' : '➖'} ${line} (balance now ${cur} ${n(r.balance)})`)
  return out.ok(add ? '$PEP added!' : '$PEP removed!', `🍕 ${line}\n\nBalance: ${cur} ${n(r.balance)}`, { ping: target })
}

async function component(i: Interaction, userId: string, deps: HandlerDeps, cur: string, out: Out): Promise<InteractionResponse> {
  const m = /^bj:(hit|stand):([a-z0-9]{10,40})$/.exec(i.data?.custom_id ?? '')
  if (!m) return out.error('Unknown button.')
  if (!deps.gamesEnabled()) return out.error("Games aren't enabled right now.")
  const r = await deps.blackjackAction(userId, m[2], m[1] as 'hit' | 'stand')
  if (!r.ok) return out.error(r.reason === 'not_yours' ? "That's not your hand." : 'That hand is gone.', r.reason === 'not_yours' ? 'Start your own with /blackjack.' : undefined)
  return out.update(blackjackEmbed(r.game, cur, out, r.balance, userId), blackjackButtons(r.game))
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

// ------------------------------------------------------------- blackjack ---

const SUIT: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
export const cardLabel = (c: string) => (c === '??' ? '🂠' : `${c[0] === 'T' ? '10' : c[0]}${SUIT[c[1]] ?? ''}`)

const OUTCOME: Record<string, { tone: Tone; text: string }> = {
  blackjack: { tone: 'success', text: 'Blackjack! You win' },
  win: { tone: 'success', text: 'You win' },
  dealer_bust: { tone: 'success', text: 'Dealer busts. You win' },
  push: { tone: 'success', text: 'Push. Your stake comes back:' },
  lose: { tone: 'error', text: 'Dealer wins.' },
  bust: { tone: 'error', text: 'Bust! Dealer wins.' },
  dealer_blackjack: { tone: 'error', text: 'Dealer has blackjack.' },
}

/** The hand as an embed: amber while it waits for Hit/Stand, then green (win/push) or red (loss). */
function blackjackEmbed(g: BlackjackView, cur: string, out: Out, balance?: number, userId?: string): Embed {
  const { headline, tone, lines } = renderBlackjack(g, cur, balance, userId)
  return out.embed(tone, headline, lines.join('\n'))
}

export function renderBlackjack(
  g: BlackjackView,
  cur: string,
  balance?: number,
  userId?: string,
): { tone: Tone; headline: string; lines: string[] } {
  const who = userId ? `<@${userId}>'s ` : ''
  const lines = [
    `🃏 ${who}**Blackjack**, bet ${cur} **${n(g.bet)}**`,
    `You: ${g.player.map(cardLabel).join(' ')} (**${g.playerTotal}**)`,
    `Dealer: ${g.dealer.map(cardLabel).join(' ')}${g.dealerTotal != null ? ` (**${g.dealerTotal}**)` : ''}`,
  ]
  if (g.status === 'SETTLED') {
    const o = OUTCOME[g.outcome ?? ''] ?? { tone: 'success' as const, text: 'Settled.' }
    const headline = `${g.autoStood ? 'Timed out, auto-stood. ' : ''}${o.text}${g.payout ? ` ${cur} **${n(g.payout)}**` : ''}`
    if (balance !== undefined) lines.push('', `Balance: ${cur} ${n(balance)}`)
    return { tone: o.tone, headline, lines }
  }
  lines.push('', `Auto-stands <t:${Math.ceil(new Date(g.expiresAt).getTime() / 1000)}:R>.`)
  return { tone: 'cooldown', headline: 'Hit or stand?', lines }
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
  return s.replace(/([*_`~|>\\[\]])/g, '\\$1').replace(/@/g, '@\u200b')
}
