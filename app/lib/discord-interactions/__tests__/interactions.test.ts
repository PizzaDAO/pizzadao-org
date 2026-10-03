// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyDiscordRequest } from '../verify'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'
import { ValidationError } from '../../errors/api-errors'

const GUILD = '812097286003359764'
const USER = '100000000000000001'

// Real Ed25519 keypair, so verification is exercised end to end.
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUBLIC_HEX = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('hex')
function signed(body: string, ts = String(Math.floor(Date.now() / 1000))) {
  const sig = sign(null, Buffer.from(ts + body), privateKey).toString('hex')
  return { sig, ts }
}

describe('verifyDiscordRequest', () => {
  it('accepts a valid signature and rejects tampering, wrong keys and stale timestamps', () => {
    const body = '{"type":1}'
    const { sig, ts } = signed(body)
    expect(verifyDiscordRequest({ publicKeyHex: PUBLIC_HEX, signatureHex: sig, timestamp: ts, rawBody: body })).toBe(true)
    expect(verifyDiscordRequest({ publicKeyHex: PUBLIC_HEX, signatureHex: sig, timestamp: ts, rawBody: '{"type":2}' })).toBe(false)
    const other = (generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('hex')
    expect(verifyDiscordRequest({ publicKeyHex: other, signatureHex: sig, timestamp: ts, rawBody: body })).toBe(false)
    const old = signed(body, String(Math.floor(Date.now() / 1000) - 3600))
    expect(verifyDiscordRequest({ publicKeyHex: PUBLIC_HEX, signatureHex: old.sig, timestamp: old.ts, rawBody: body })).toBe(false)
    expect(verifyDiscordRequest({ publicKeyHex: PUBLIC_HEX, signatureHex: null, timestamp: ts, rawBody: body })).toBe(false)
    expect(verifyDiscordRequest({ publicKeyHex: PUBLIC_HEX, signatureHex: 'zz', timestamp: ts, rawBody: body })).toBe(false)
  })
})

describe('handleInteraction', () => {
  const OTHER = '100000000000000009'
  const CUR = '<:pepperoni:973304305979367444>'
  const bjView = (over: Record<string, unknown> = {}) => ({
    id: 'cabcdefghijklmnop',
    bet: 100,
    status: 'ACTIVE' as const,
    player: ['AS', '7H'],
    dealer: ['9D', '??'],
    playerTotal: 18,
    dealerTotal: null,
    outcome: null,
    payout: null,
    expiresAt: new Date(1_800_000_000_000).toISOString(),
    ...over,
  })
  const deps = (over: Partial<HandlerDeps> = {}): HandlerDeps => ({
    guildId: GUILD,
    getWallet: vi.fn(async (id: string) => (id === USER ? 1234 : 7)),
    doWork: vi.fn(async () => ({ ok: true as const, amount: 42, balance: 1276, prompt: 'You folded boxes: {amount}.' })),
    currency: CUR,
    collectIncome: vi.fn(async () => ({ paid: [], waiting: [], total: 0, balance: 0 })),
    pay: vi.fn(async () => ({ success: true })),
    leaderboard: vi.fn(async () => []),
    robEnabled: () => true,
    rob: vi.fn(async () => ({ ok: false as const, reason: 'cooldown' as const, readyAt: new Date(1_800_000_000_000) })),
    getPeace: vi.fn(async () => false),
    setPeace: vi.fn(async () => ({ ok: true as const, enabled: true, changed: true })),
    gamesEnabled: () => true,
    startBlackjack: vi.fn(async () => ({ ok: true as const, game: bjView() as never, balance: 900 })),
    blackjackAction: vi.fn(async () => ({ ok: true as const, game: bjView() as never, balance: 900 })),
    roulette: vi.fn(async () => ({ ok: true as const, bet: 100, balance: 1100, payout: 200, landed: 7, color: 'red', space: 'red', multiplier: 2 })),
    slots: vi.fn(async () => ({ ok: true as const, bet: 10, balance: 990, payout: 0, reels: ['tomato', 'cheese', 'pepper'], multiplier: 0 })),
    shopItems: vi.fn(async () => [
      { id: 1, name: 'Pizza Sticks', price: 1337, quantity: -1 },
      { id: 2, name: 'Rare Pizza Box', price: 42069, quantity: 3 },
    ]),
    buy: vi.fn(async () => ({ item: 'Pizza Sticks', quantity: 1, totalCost: 1337 })),
    ...over,
  })
  type Opt = { name: string; type: number; value: unknown; focused?: boolean }
  const cmd = (name: string, options?: Opt[], extra: Record<string, unknown> = {}) => ({
    type: 2,
    guild_id: GUILD,
    member: { user: { id: USER }, roles: ['r1', 'r2'], joined_at: '2024-01-01T00:00:00.000Z' },
    data: { name, options, ...extra },
  })
  const content = (r: { data?: { content?: string } }) => r.data?.content ?? ''

  it('answers PING with PONG', async () => {
    expect(await handleInteraction({ type: 1 }, deps())).toEqual({ type: 1 })
  })

  it('/balance replies ephemerally for self and for another member, without pings', async () => {
    const self = await handleInteraction(cmd('balance'), deps())
    expect(self.data).toMatchObject({ content: expect.stringContaining('**1,234**'), flags: 64, allowed_mentions: { parse: [] } })
    const other = await handleInteraction(cmd('balance', [{ name: 'member', type: 6, value: OTHER }]), deps())
    expect(content(other)).toBe(`<@${OTHER}> has ${CUR} **7**`)
  })

  it('/work posts the prompt with the amount filled in', async () => {
    const r = await handleInteraction(cmd('work'), deps())
    expect(r.data?.flags).toBeUndefined()
    expect(content(r)).toBe(`You folded boxes: ${CUR} **42**.\nBalance: ${CUR} 1,276`)
  })

  it('/work on cooldown replies ephemerally with a Discord relative timestamp', async () => {
    const r = await handleInteraction(cmd('work'), deps({ doWork: vi.fn(async () => ({ ok: false as const, readyAt: new Date(1_800_000_000_500) })) }))
    expect(r.data).toMatchObject({ flags: 64, content: expect.stringContaining('<t:1800000001:R>') })
  })

  it('refuses other guilds and DMs, and unknown commands', async () => {
    expect(content(await handleInteraction({ ...cmd('work'), guild_id: '1' }, deps()))).toMatch(/only work in the PizzaDAO server/)
    expect(content(await handleInteraction({ ...cmd('work'), guild_id: undefined }, deps()))).toMatch(/only work/)
    expect(content(await handleInteraction(cmd('slut'), deps()))).toBe('Unknown command.')
  })

  it('/collect-income passes member.roles and lists paid and waiting roles', async () => {
    const collectIncome = vi.fn(async () => ({
      paid: [{ name: 'Crew Member', roleId: 'r1', amount: 42 }],
      waiting: [{ name: 'Pizza Holder', roleId: 'r2', readyAt: new Date(1_800_000_000_000) }],
      total: 42,
      balance: 1042,
    }))
    const r = await handleInteraction(cmd('collect-income'), deps({ collectIncome }))
    expect(collectIncome).toHaveBeenCalledWith(USER, ['r1', 'r2'])
    expect(r.data?.flags).toBeUndefined()
    expect(content(r)).toContain(`+ ${CUR} **42** from **Crew Member**`)
    expect(content(r)).toContain('**Pizza Holder**: next collection <t:1800000000:R>')
    const none = await handleInteraction(cmd('collect-income'), deps())
    expect(none.data?.flags).toBe(64)
  })

  it('/pay validates and calls the hardened transfer', async () => {
    const pay = vi.fn(async () => ({}))
    const d = deps({ pay })
    const ok = await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: 50 }]), d)
    expect(pay).toHaveBeenCalledWith(USER, OTHER, 50)
    expect(content(ok)).toBe(`<@${USER}> paid <@${OTHER}> ${CUR} **50**.`)
    expect(ok.data?.allowed_mentions).toEqual({ parse: [] })
    expect(content(await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: USER }, { name: 'amount', type: 4, value: 5 }]), d))).toMatch(/yourself/)
    expect(content(await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: 1.5 }]), d))).toMatch(/whole number/)
    expect(content(await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: -5 }]), d))).toMatch(/positive/)
    const bot = cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: 5 }], { resolved: { users: { [OTHER]: { id: OTHER, bot: true } } } })
    expect(content(await handleInteraction(bot, d))).toMatch(/bot/)
    expect(pay).toHaveBeenCalledTimes(1)
  })

  it('shows validation errors (e.g. insufficient funds) ephemerally', async () => {
    const pay = vi.fn(async () => {
      throw new ValidationError('Insufficient funds')
    })
    const r = await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: 5 }]), deps({ pay }))
    expect(r.data).toMatchObject({ content: 'Insufficient funds', flags: 64 })
  })

  it('/leaderboard uses names where known and silent mentions otherwise', async () => {
    const leaderboard = vi.fn(async () => [
      { userId: USER, balance: 9000, name: 'Snax*' },
      { userId: OTHER, balance: 10, name: null },
    ])
    const r = await handleInteraction(cmd('leaderboard'), deps({ leaderboard }))
    expect(content(r)).toContain(`🥇 Snax\\*: ${CUR} 9,000`)
    expect(content(r)).toContain(`🥈 <@${OTHER}>: ${CUR} 10`)
    expect(r.data?.allowed_mentions).toEqual({ parse: [] })
  })

  it('/rob passes join dates and bot flag, and explains refusals', async () => {
    const rob = vi.fn(async () => ({ ok: true as const, outcome: 'success' as const, amount: 120, percent: 12, robberBalance: 1, victimBalance: 1 }))
    const i = cmd('rob', [{ name: 'member', type: 6, value: OTHER }], {
      resolved: { users: { [OTHER]: { id: OTHER } }, members: { [OTHER]: { joined_at: '2025-01-01T00:00:00.000Z' } } },
    })
    const r = await handleInteraction(i, deps({ rob }))
    expect(rob).toHaveBeenCalledWith(USER, OTHER, {
      victimIsBot: false,
      robberJoinedAt: new Date('2024-01-01T00:00:00.000Z'),
      victimJoinedAt: new Date('2025-01-01T00:00:00.000Z'),
    })
    expect(content(r)).toMatch(/robbed <@100000000000000009> and got away with .*\*\*120\*\*/)

    const caught = vi.fn(async () => ({ ok: true as const, outcome: 'caught' as const, amount: 75, percent: 15, robberBalance: 1, victimBalance: 1 }))
    expect(content(await handleInteraction(i, deps({ rob: caught })))).toMatch(/got caught .* \*\*75\*\* fine/)

    const refused = await handleInteraction(i, deps())
    expect(refused.data).toMatchObject({ flags: 64, content: expect.stringContaining('<t:1800000000:R>') })

    const notMember = cmd('rob', [{ name: 'member', type: 6, value: OTHER }], { resolved: { users: { [OTHER]: { id: OTHER } } } })
    expect(content(await handleInteraction(notMember, deps({ rob })))).toMatch(/not in the server/)
    expect(content(await handleInteraction(i, deps({ robEnabled: () => false })))).toMatch(/isn't enabled/)
  })

  it('/peace shows status and toggles', async () => {
    expect(content(await handleInteraction(cmd('peace'), deps()))).toMatch(/off/)
    const setPeace = vi.fn(async () => ({ ok: true as const, enabled: true, changed: true }))
    expect(content(await handleInteraction(cmd('peace', [{ name: 'enabled', type: 5, value: true }]), deps({ setPeace })))).toMatch(/now \*\*on\*\*/)
    expect(setPeace).toHaveBeenCalledWith(USER, true)
    const cd = vi.fn(async () => ({ ok: false as const, reason: 'cooldown' as const, readyAt: new Date(1_800_000_000_000) }))
    expect(content(await handleInteraction(cmd('peace', [{ name: 'enabled', type: 5, value: false }]), deps({ setPeace: cd })))).toMatch(/<t:1800000000:R>/)
  })

  it('/blackjack posts the hand with Hit/Stand buttons; buttons update the message', async () => {
    const r = await handleInteraction(cmd('blackjack', [{ name: 'bet', type: 4, value: 100 }]), deps())
    expect(content(r)).toContain('A♠ 7♥ (**18**)')
    expect(content(r)).toContain('Dealer: 9♦ 🂠')
    const buttons = (r.data?.components?.[0] as { components: Array<{ custom_id: string }> }).components
    expect(buttons.map((b) => b.custom_id)).toEqual(['bj:hit:cabcdefghijklmnop', 'bj:stand:cabcdefghijklmnop'])

    const settled = bjView({ status: 'SETTLED', dealer: ['9D', 'TC'], dealerTotal: 19, playerTotal: 21, player: ['AS', '7H', '3C'], outcome: 'win', payout: 200 })
    const blackjackAction = vi.fn(async () => ({ ok: true as const, game: settled as never, balance: 1100 }))
    const press = { type: 3, guild_id: GUILD, member: { user: { id: USER } }, data: { custom_id: 'bj:stand:cabcdefghijklmnop', component_type: 2 } }
    const u = await handleInteraction(press, deps({ blackjackAction }))
    expect(blackjackAction).toHaveBeenCalledWith(USER, 'cabcdefghijklmnop', 'stand')
    expect(u.type).toBe(7)
    expect(u.data?.components).toEqual([])
    expect(content(u)).toContain(`You win ${CUR} **200**`)

    const notYours = await handleInteraction(press, deps({ blackjackAction: vi.fn(async () => ({ ok: false as const, reason: 'not_yours' as const })) }))
    expect(notYours).toMatchObject({ type: 4, data: { flags: 64 } })
    expect(content(await handleInteraction({ ...press, data: { custom_id: 'evil' } }, deps()))).toBe('Unknown button.')
  })

  it('/roulette and /slots report the spin; games can be switched off', async () => {
    const ro = await handleInteraction(cmd('roulette', [{ name: 'bet', type: 4, value: 100 }, { name: 'space', type: 3, value: 'red' }]), deps())
    expect(content(ro)).toContain('🔴 **7**')
    expect(content(ro)).toContain(`You win ${CUR} **200** (2x)!`)
    const sl = await handleInteraction(cmd('slots', [{ name: 'bet', type: 4, value: 10 }]), deps())
    expect(content(sl)).toContain('[ 🍅 | 🧀 | 🌶️ ]')
    expect(content(sl)).toContain('No luck.')
    const off = await handleInteraction(cmd('slots', [{ name: 'bet', type: 4, value: 10 }]), deps({ gamesEnabled: () => false }))
    expect(off.data).toMatchObject({ flags: 64, content: expect.stringMatching(/aren't enabled/) })
  })

  it('/shop lists items, /buy resolves by id or name, autocomplete suggests items', async () => {
    expect(content(await handleInteraction(cmd('shop'), deps()))).toContain(`**Rare Pizza Box**: ${CUR} 42,069 (3 left)`)
    const buy = vi.fn(async () => ({ item: 'Rare Pizza Box', quantity: 1, totalCost: 42069 }))
    await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value: '2' }]), deps({ buy }))
    await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value: 'rare pizza box' }, { name: 'quantity', type: 4, value: 2 }]), deps({ buy }))
    expect(buy.mock.calls).toEqual([[USER, 2, 1], [USER, 2, 2]])
    expect(content(await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value: 'nope' }]), deps({ buy })))).toMatch(/No shop item/)
    const ac = await handleInteraction({ ...cmd('buy', [{ name: 'item', type: 3, value: 'rare', focused: true }]), type: 4 }, deps())
    expect(ac).toEqual({ type: 8, data: { choices: [{ name: 'Rare Pizza Box (42,069)', value: '2' }] } })
  })

  it('registers every command that has a handler, and nothing else', () => {
    expect(PEP_COMMANDS.map((c) => c.name)).toEqual([
      'balance', 'work', 'collect-income', 'pay', 'leaderboard', 'rob', 'peace', 'blackjack', 'roulette', 'slots', 'shop', 'buy',
    ])
  })
})

describe('POST /api/discord/interactions', () => {
  const doWork = vi.fn()
  const findUnique = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/app/lib/pep-earn/work', () => ({ doWork }))
    vi.doMock('@/app/lib/db', () => ({ prisma: { economy: { findUnique } } }))
    process.env.DISCORD_PUBLIC_KEY = PUBLIC_HEX
    process.env.DISCORD_GUILD_ID = GUILD
    doWork.mockReset()
    findUnique.mockReset()
  })
  afterEach(() => {
    delete process.env.DISCORD_PUBLIC_KEY
    delete process.env.DISCORD_GUILD_ID
  })

  async function post(body: unknown, sigOverride?: string) {
    const { POST } = await import('@/app/api/discord/interactions/route')
    const raw = JSON.stringify(body)
    const { sig, ts } = signed(raw)
    return POST(
      new Request('https://app.pizzadao.org/api/discord/interactions', {
        method: 'POST',
        headers: { 'x-signature-ed25519': sigOverride ?? sig, 'x-signature-timestamp': ts, 'content-type': 'application/json' },
        body: raw,
      }),
    )
  }

  it('401s on a bad signature (Discord probes this when the URL is saved)', async () => {
    const res = await post({ type: 1 }, '00'.repeat(64))
    expect(res.status).toBe(401)
  })

  it('PONGs a signed PING', async () => {
    const res = await post({ type: 1 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ type: 1 })
  })

  it('serves /balance from a read-only wallet lookup', async () => {
    findUnique.mockResolvedValue({ wallet: 5000 })
    const res = await post({ type: 2, guild_id: GUILD, member: { user: { id: USER } }, data: { name: 'balance' } })
    expect((await res.json()).data.content).toContain('**5,000**')
    expect(findUnique).toHaveBeenCalledWith({ where: { id: USER }, select: { wallet: true } })
  })

  it('returns an ephemeral error message if the handler throws', async () => {
    doWork.mockRejectedValue(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post({ type: 2, guild_id: GUILD, member: { user: { id: USER } }, data: { name: 'work' } })
    expect(await res.json()).toMatchObject({ type: 4, data: { flags: 64 } })
    spy.mockRestore()
  })

  it('503s when DISCORD_PUBLIC_KEY is not configured', async () => {
    delete process.env.DISCORD_PUBLIC_KEY
    expect((await post({ type: 1 })).status).toBe(503)
  })
})
