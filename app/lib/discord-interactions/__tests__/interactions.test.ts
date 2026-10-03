// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyDiscordRequest } from '../verify'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'
import { ValidationError } from '../../errors/api-errors'
import { isPepAdmin, pepAdminRoleConfig } from '../../pep-admin'

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
  const ADMIN_ROLE = '815976204900499537'
  const MAFIA_ROLE = '823266914834841610' // Pepperoni Mafia
  const CUR = '<:pepperoni:973304305979367444>'
  const GREEN = 0x2ecc71
  const RED = 0xe74c3c
  const AMBER = 0xf39c12
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
    doWork: vi.fn(async () => ({ ok: true as const, amount: 42, balance: 1276, prompt: 'You folded boxes: {amount}. See [the calls](<https://app.pizzadao.org/calls>).' })),
    currency: CUR,
    collectIncome: vi.fn(async () => ({ paid: [], waiting: [], total: 0, balance: 0 })),
    pay: vi.fn(async () => ({ success: true })),
    leaderboard: vi.fn(async () => []),
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
    // The real check, with the default config (Pepperoni Mafia) and no guild role list.
    isAdmin: (roles) => isPepAdmin(roles, { baseRoleIds: [ADMIN_ROLE], config: pepAdminRoleConfig({}), getGuildRoles: async () => null }),
    adminGrantMax: 10_000,
    addMoney: vi.fn(async (_a: string, _t: string, amount: number) => ({ ok: true as const, amount, balance: 1000 + amount })),
    removeMoney: vi.fn(async (_a: string, _t: string, amount: number) => ({ ok: true as const, amount, balance: 1000 - amount })),
    logAdmin: vi.fn(),
    ...over,
  })
  type Opt = { name: string; type: number; value: unknown; focused?: boolean }
  const cmd = (name: string, options?: Opt[], extra: Record<string, unknown> = {}, roles = ['r1', 'r2']) => ({
    type: 2,
    guild_id: GUILD,
    member: {
      user: { id: USER, username: 'snax', global_name: 'Snax', avatar: 'a_0123456789abcdef0123456789abcdef' },
      nick: null,
      roles,
      joined_at: '2024-01-01T00:00:00.000Z',
    },
    data: { name, options, ...extra },
  })
  type Res = { data?: { content?: string; embeds?: Array<{ description: string; color: number; author?: { name: string; icon_url: string }; fields?: Array<{ name: string; value: string }> }> } }
  const embed = (r: Res) => r.data?.embeds?.[0]
  const desc = (r: Res) => embed(r)?.description ?? ''

  it('answers PING with PONG', async () => {
    expect(await handleInteraction({ type: 1 }, deps())).toEqual({ type: 1 })
  })

  it('every reply is an embed authored by the invoking member', async () => {
    const r = await handleInteraction(cmd('work'), deps())
    expect(r.data?.content).toBeUndefined()
    expect(embed(r)?.author).toEqual({
      name: 'Snax',
      icon_url: `https://cdn.discordapp.com/avatars/${USER}/a_0123456789abcdef0123456789abcdef.gif`,
    })
    const plain = { ...cmd('work'), member: { user: { id: USER, username: 'snax' }, nick: 'Chef' } }
    const a = embed(await handleInteraction(plain, deps()))?.author
    expect(a?.name).toBe('Chef')
    expect(a?.icon_url).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/)
    const guildAvatar = { ...cmd('work'), member: { user: { id: USER }, avatar: 'abcdef0123456789abcdef0123456789' } }
    expect(embed(await handleInteraction(guildAvatar, deps()))?.author?.icon_url).toBe(
      `https://cdn.discordapp.com/guilds/${GUILD}/users/${USER}/avatars/abcdef0123456789abcdef0123456789.png`,
    )
  })

  it('/balance shows a Wallet field ephemerally for self and for another member, without pings', async () => {
    const self = await handleInteraction(cmd('balance'), deps())
    expect(self.data).toMatchObject({ flags: 64, allowed_mentions: { parse: [] } })
    expect(embed(self)).toMatchObject({ color: GREEN, description: '✅ Your balance', fields: [{ name: 'Wallet', value: `${CUR} 1,234` }] })
    const other = await handleInteraction(cmd('balance', [{ name: 'member', type: 6, value: OTHER }]), deps())
    expect(desc(other)).toBe(`✅ Balance of <@${OTHER}>`)
    expect(embed(other)?.fields?.[0].value).toBe(`${CUR} 7`)
  })

  it('/work posts the prompt (masked links intact) with the amount earned', async () => {
    const r = await handleInteraction(cmd('work'), deps())
    expect(r.data?.flags).toBeUndefined()
    expect(embed(r)?.color).toBe(GREEN)
    expect(desc(r)).toBe(
      `✅ Shift complete!\n\nYou folded boxes: ${CUR} **42**. See [the calls](<https://app.pizzadao.org/calls>).\n\nEarned: ${CUR} 42 • Balance: ${CUR} 1,276`,
    )
  })

  it('/work on cooldown is an amber ephemeral embed with a Discord relative timestamp', async () => {
    const r = await handleInteraction(cmd('work'), deps({ doWork: vi.fn(async () => ({ ok: false as const, readyAt: new Date(1_800_000_000_500) })) }))
    expect(r.data?.flags).toBe(64)
    expect(embed(r)?.color).toBe(AMBER)
    expect(desc(r)).toMatch(/^⏳ You're still on your break\.\n\n.*<t:1800000001:R>/)
  })

  it('refuses other guilds and DMs, and unknown commands, with red ephemeral embeds', async () => {
    const other = await handleInteraction({ ...cmd('work'), guild_id: '1' }, deps())
    expect(other.data?.flags).toBe(64)
    expect(embed(other)?.color).toBe(RED)
    expect(desc(other)).toMatch(/^❌ These commands only work in the PizzaDAO server/)
    expect(desc(await handleInteraction({ ...cmd('work'), guild_id: undefined }, deps()))).toMatch(/only work/)
    expect(desc(await handleInteraction(cmd('slut'), deps()))).toBe('❌ Unknown command.')
  })

  it('/collect-income passes member.roles and lists paid roles numbered, largest first, as role pills', async () => {
    const collectIncome = vi.fn(async () => ({
      paid: [
        { name: 'Crew Member', roleId: '900000000000000001', amount: 42 },
        { name: 'Pizza Capo', roleId: '839206162837798945', amount: 420 },
      ],
      waiting: [{ name: 'Pizza Holder', roleId: '900000000000000002', readyAt: new Date(1_800_000_000_000) }],
      total: 462,
      balance: 5871,
    }))
    const r = await handleInteraction(cmd('collect-income'), deps({ collectIncome }))
    expect(collectIncome).toHaveBeenCalledWith(USER, ['r1', 'r2'])
    expect(r.data?.flags).toBeUndefined()
    expect(r.data?.allowed_mentions).toEqual({ parse: [] })
    expect(embed(r)?.color).toBe(GREEN)
    expect(desc(r)).toBe(
      [
        '✅ Role income successfully collected!',
        '',
        `1 - <@&839206162837798945> ${CUR} 420`,
        `2 - <@&900000000000000001> ${CUR} 42`,
        '',
        `Total: ${CUR} 462 • Balance: ${CUR} 5,871`,
        '',
        '<@&900000000000000002>: next collection <t:1800000000:R>',
      ].join('\n'),
    )
    const none = await handleInteraction(cmd('collect-income'), deps())
    expect(none.data?.flags).toBe(64)
    expect(embed(none)?.color).toBe(RED)
    const waiting = await handleInteraction(
      cmd('collect-income'),
      deps({ collectIncome: vi.fn(async () => ({ paid: [], waiting: [{ name: 'X', roleId: '900000000000000002', readyAt: new Date(1_800_000_000_000) }], total: 0, balance: 1 })) }),
    )
    expect(embed(waiting)?.color).toBe(AMBER)
    expect(desc(waiting)).toMatch(/^⏳ Nothing to collect yet\./)
  })

  it('/pay validates, calls the hardened transfer and pings only the recipient', async () => {
    const pay = vi.fn(async () => ({}))
    const d = deps({ pay })
    const ok = await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: 50 }]), d)
    expect(pay).toHaveBeenCalledWith(USER, OTHER, 50)
    expect(desc(ok)).toBe(`✅ Payment sent!\n\n<@${USER}> paid <@${OTHER}> ${CUR} **50**.`)
    expect(ok.data?.content).toBe(`<@${OTHER}>`)
    expect(ok.data?.allowed_mentions).toEqual({ parse: [], users: [OTHER] })
    expect(desc(await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: USER }, { name: 'amount', type: 4, value: 5 }]), d))).toMatch(/yourself/)
    expect(desc(await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: 1.5 }]), d))).toMatch(/whole number/)
    expect(desc(await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: -5 }]), d))).toMatch(/positive/)
    const bot = cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: 5 }], { resolved: { users: { [OTHER]: { id: OTHER, bot: true } } } })
    expect(desc(await handleInteraction(bot, d))).toMatch(/bot/)
    expect(pay).toHaveBeenCalledTimes(1)
  })

  it('shows validation errors (e.g. insufficient funds) as red ephemeral embeds', async () => {
    const pay = vi.fn(async () => {
      throw new ValidationError('Insufficient funds')
    })
    const r = await handleInteraction(cmd('pay', [{ name: 'member', type: 6, value: OTHER }, { name: 'amount', type: 4, value: 5 }]), deps({ pay }))
    expect(r.data).toMatchObject({ flags: 64, allowed_mentions: { parse: [] } })
    expect(embed(r)).toMatchObject({ color: RED, description: '❌ Insufficient funds' })
  })

  it('/leaderboard is a numbered list of silent mentions', async () => {
    const leaderboard = vi.fn(async () => [
      { userId: USER, balance: 9000 },
      { userId: OTHER, balance: 10 },
    ])
    const r = await handleInteraction(cmd('leaderboard'), deps({ leaderboard }))
    expect(desc(r)).toBe(`✅ $PEP leaderboard\n\n1 - <@${USER}> ${CUR} 9,000\n2 - <@${OTHER}> ${CUR} 10`)
    expect(r.data?.allowed_mentions).toEqual({ parse: [] })
  })

  it('/blackjack posts the hand as an embed with Hit/Stand buttons; buttons update it', async () => {
    const r = await handleInteraction(cmd('blackjack', [{ name: 'bet', type: 4, value: 100 }]), deps())
    expect(embed(r)?.color).toBe(AMBER)
    expect(desc(r)).toMatch(/^⏳ Hit or stand\?/)
    expect(desc(r)).toContain('A♠ 7♥ (**18**)')
    expect(desc(r)).toContain('Dealer: 9♦ 🂠')
    const buttons = (r.data?.components?.[0] as { components: Array<{ custom_id: string }> }).components
    expect(buttons.map((b) => b.custom_id)).toEqual(['bj:hit:cabcdefghijklmnop', 'bj:stand:cabcdefghijklmnop'])

    const settled = bjView({ status: 'SETTLED', dealer: ['9D', 'TC'], dealerTotal: 19, playerTotal: 21, player: ['AS', '7H', '3C'], outcome: 'win', payout: 200 })
    const blackjackAction = vi.fn(async () => ({ ok: true as const, game: settled as never, balance: 1100 }))
    const press = { type: 3, guild_id: GUILD, member: { user: { id: USER } }, data: { custom_id: 'bj:stand:cabcdefghijklmnop', component_type: 2 } }
    const u = await handleInteraction(press, deps({ blackjackAction }))
    expect(blackjackAction).toHaveBeenCalledWith(USER, 'cabcdefghijklmnop', 'stand')
    expect(u.type).toBe(7)
    expect(u.data?.components).toEqual([])
    expect(embed(u)?.color).toBe(GREEN)
    expect(desc(u)).toMatch(new RegExp(`^✅ You win ${CUR} \\*\\*200\\*\\*`))

    const lost = vi.fn(async () => ({ ok: true as const, game: bjView({ ...settled, outcome: 'bust', payout: 0 }) as never, balance: 900 }))
    expect(embed(await handleInteraction(press, deps({ blackjackAction: lost })))?.color).toBe(RED)

    const notYours = await handleInteraction(press, deps({ blackjackAction: vi.fn(async () => ({ ok: false as const, reason: 'not_yours' as const })) }))
    expect(notYours).toMatchObject({ type: 4, data: { flags: 64 } })
    expect(desc(await handleInteraction({ ...press, data: { custom_id: 'evil' } }, deps()))).toBe('❌ Unknown button.')
  })

  it('/roulette and /slots report the spin; games can be switched off', async () => {
    const ro = await handleInteraction(cmd('roulette', [{ name: 'bet', type: 4, value: 100 }, { name: 'space', type: 3, value: 'red' }]), deps())
    expect(desc(ro)).toMatch(new RegExp(`^✅ You win ${CUR} \\*\\*200\\*\\* \\(2x\\)!`))
    expect(desc(ro)).toContain('🔴 **7**')
    const sl = await handleInteraction(cmd('slots', [{ name: 'bet', type: 4, value: 10 }]), deps())
    expect(desc(sl)).toContain('[ 🍅 | 🧀 | 🌶️ ]')
    expect(desc(sl)).toMatch(/^❌ No luck\./)
    expect(embed(sl)?.color).toBe(RED)
    expect(sl.data?.flags).toBeUndefined()
    const off = await handleInteraction(cmd('slots', [{ name: 'bet', type: 4, value: 10 }]), deps({ gamesEnabled: () => false }))
    expect(off.data?.flags).toBe(64)
    expect(desc(off)).toMatch(/aren't enabled/)
  })

  it('/shop lists items numbered, /buy resolves by id or name, autocomplete suggests items', async () => {
    const shop = desc(await handleInteraction(cmd('shop'), deps()))
    expect(shop).toContain(`1 - **Pizza Sticks** ${CUR} 1,337`)
    expect(shop).toContain(`2 - **Rare Pizza Box** ${CUR} 42,069 (3 left)`)
    const buy = vi.fn(async () => ({ item: 'Rare Pizza Box', quantity: 1, totalCost: 42069 }))
    await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value: '2' }]), deps({ buy }))
    await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value: 'rare pizza box' }, { name: 'quantity', type: 4, value: 2 }]), deps({ buy }))
    expect(buy.mock.calls).toEqual([[USER, 2, 1], [USER, 2, 2]])
    expect(desc(await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value: '2' }]), deps({ buy })))).toMatch(/^✅ Purchase complete!/)
    expect(desc(await handleInteraction(cmd('buy', [{ name: 'item', type: 3, value: 'nope' }]), deps({ buy })))).toMatch(/No shop item/)
    const ac = await handleInteraction({ ...cmd('buy', [{ name: 'item', type: 3, value: 'rare', focused: true }]), type: 4 }, deps())
    expect(ac).toEqual({ type: 8, data: { choices: [{ name: 'Rare Pizza Box (42,069)', value: '2' }] } })
  })

  describe('/add-money and /remove-money', () => {
    const resolved = { users: { [OTHER]: { id: OTHER } }, members: { [OTHER]: { roles: [] } } }
    const money = (name: 'add-money' | 'remove-money', amount: unknown, reason: unknown, roles = [ADMIN_ROLE], target: string = OTHER, res: unknown = resolved) =>
      cmd(
        name,
        [
          { name: 'member', type: 6, value: target },
          { name: 'amount', type: 4, value: amount },
          { name: 'reason', type: 3, value: reason },
        ],
        { resolved: res },
        roles,
      )

    it('rejects non-admins before touching anything', async () => {
      const d = deps()
      for (const name of ['add-money', 'remove-money'] as const) {
        const r = await handleInteraction(money(name, 100, 'bonus', ['r1']), d)
        expect(r.data?.flags).toBe(64)
        expect(embed(r)).toMatchObject({ color: RED, description: '❌ Only admins can use this command.' })
      }
      // Even with an invalid amount, a non-admin only learns that they're not an admin.
      expect(desc(await handleInteraction(money('add-money', -1, 'x', []), d))).toBe('❌ Only admins can use this command.')
      expect(desc(await handleInteraction(money('add-money', 100, 'bonus'), deps({ isAdmin: async () => false })))).toMatch(/Only admins/)
      expect(d.addMoney).not.toHaveBeenCalled()
      expect(d.removeMoney).not.toHaveBeenCalled()
    })

    it('allows Pepperoni Mafia holders (and ADMIN_ROLE_IDS holders)', async () => {
      const d = deps()
      const mafia = await handleInteraction(money('add-money', 100, 'mission bonus', ['r1', MAFIA_ROLE]), d)
      expect(embed(mafia)?.color).toBe(GREEN)
      expect(d.addMoney).toHaveBeenCalledWith(USER, OTHER, 100, 'mission bonus')
      const removed = await handleInteraction(money('remove-money', 10, 'oops fix', [MAFIA_ROLE]), d)
      expect(embed(removed)?.color).toBe(GREEN)
      expect(d.removeMoney).toHaveBeenCalledWith(USER, OTHER, 10, 'oops fix')
      expect(embed(await handleInteraction(money('add-money', 1, 'admin', [ADMIN_ROLE]), d))?.color).toBe(GREEN)
    })

    it('validates amount, cap, reason, target', async () => {
      const d = deps({ adminGrantMax: 500 })
      const err = async (i: ReturnType<typeof money>) => desc(await handleInteraction(i, d))
      expect(await err(money('add-money', 0, 'bonus'))).toMatch(/positive whole number/)
      expect(await err(money('add-money', -5, 'bonus'))).toMatch(/positive whole number/)
      expect(await err(money('add-money', 1.5, 'bonus'))).toMatch(/positive whole number/)
      expect(await err(money('add-money', '100', 'bonus'))).toMatch(/positive whole number/)
      expect(await err(money('add-money', 501, 'bonus'))).toMatch(/at most 500/)
      expect(await err(money('remove-money', 501, 'bonus'))).toMatch(/at most 500/)
      expect(await err(money('add-money', 100, 'ab'))).toMatch(/Reason must be 3-200/)
      expect(await err(money('add-money', 100, '   a  '))).toMatch(/Reason must be 3-200/)
      expect(await err(money('add-money', 100, undefined))).toMatch(/Reason must be 3-200/)
      expect(await err(money('add-money', 100, 'x'.repeat(201)))).toMatch(/Reason must be 3-200/)
      expect(await err(money('add-money', 100, 'bonus', [ADMIN_ROLE], 'nope'))).toMatch(/Pick a member/)
      expect(await err(money('add-money', 100, 'bonus', [ADMIN_ROLE], OTHER, { users: { [OTHER]: { id: OTHER, bot: true } }, members: { [OTHER]: {} } }))).toMatch(/Bots/)
      expect(await err(money('add-money', 100, 'bonus', [ADMIN_ROLE], OTHER, { users: { [OTHER]: { id: OTHER } } }))).toMatch(/not in the server/)
      expect(d.addMoney).not.toHaveBeenCalled()
      expect(d.removeMoney).not.toHaveBeenCalled()
      // Exactly the cap and a 200-char reason are fine.
      await handleInteraction(money('add-money', 500, 'y'.repeat(200)), d)
      expect(d.addMoney).toHaveBeenCalledWith(USER, OTHER, 500, 'y'.repeat(200))
    })

    it('/add-money grants, replies publicly, pings only the member, and logs', async () => {
      const d = deps()
      const r = await handleInteraction(money('add-money', 314, '  /work   bonus: *mission*  '), d)
      expect(d.addMoney).toHaveBeenCalledWith(USER, OTHER, 314, '/work bonus: *mission*')
      expect(r.data?.flags).toBeUndefined()
      expect(r.data?.content).toBe(`<@${OTHER}>`)
      expect(r.data?.allowed_mentions).toEqual({ parse: [], users: [OTHER] })
      expect(embed(r)?.color).toBe(GREEN)
      expect(embed(r)?.author?.name).toBe('Snax')
      expect(desc(r)).toBe(`✅ $PEP added!\n\n🍕 <@${USER}> gave <@${OTHER}> ${CUR} **314**: /work bonus: \\*mission\\*\n\nBalance: ${CUR} 1,314`)
      expect(d.logAdmin).toHaveBeenCalledWith(expect.stringContaining(`<@${USER}> gave <@${OTHER}> ${CUR} **314**`))
    })

    it('/remove-money removes, and refuses with the current balance when it would go below 0', async () => {
      const d = deps()
      const r = await handleInteraction(money('remove-money', 250, 'duplicate payout'), d)
      expect(d.removeMoney).toHaveBeenCalledWith(USER, OTHER, 250, 'duplicate payout')
      expect(desc(r)).toBe(`✅ $PEP removed!\n\n🍕 <@${USER}> took ${CUR} **250** from <@${OTHER}>: duplicate payout\n\nBalance: ${CUR} 750`)
      expect(r.data?.allowed_mentions).toEqual({ parse: [], users: [OTHER] })

      // A member who left can still have PEP removed (no in-server requirement).
      const left = await handleInteraction(money('remove-money', 1, 'cleanup', [ADMIN_ROLE], OTHER, { users: { [OTHER]: { id: OTHER } } }), d)
      expect(embed(left)?.color).toBe(GREEN)

      const poor = deps({ removeMoney: vi.fn(async () => ({ ok: false as const, reason: 'insufficient' as const, balance: 40 })) })
      const no = await handleInteraction(money('remove-money', 250, 'duplicate payout'), poor)
      expect(no.data?.flags).toBe(64)
      expect(no.data?.allowed_mentions).toEqual({ parse: [] })
      expect(embed(no)).toMatchObject({ color: RED, description: `❌ Not enough $PEP.\n\n<@${OTHER}> only has ${CUR} **40**. Nothing was removed.` })
      expect(poor.logAdmin).not.toHaveBeenCalled()
    })

    it('are registered visible (no default_member_permissions) with three required options', () => {
      for (const name of ['add-money', 'remove-money']) {
        const c = PEP_COMMANDS.find((x) => x.name === name) as unknown as { options: Array<{ name: string; required: boolean }> }
        expect(c.options.map((o) => [o.name, o.required])).toEqual([['member', true], ['amount', true], ['reason', true]])
      }
      for (const c of PEP_COMMANDS) expect('default_member_permissions' in c).toBe(false)
    })
  })

  it('/rob and /peace are gone (a stale registration gets "Unknown command.")', async () => {
    for (const name of ['rob', 'peace']) {
      expect(desc(await handleInteraction(cmd(name), deps()))).toMatch(/Unknown command/)
    }
  })

  it('registers every command that has a handler, and nothing else', () => {
    expect(PEP_COMMANDS.map((c) => c.name)).toEqual([
      'balance', 'work', 'collect-income', 'pay', 'leaderboard', 'blackjack', 'roulette', 'slots', 'shop', 'buy',
      'add-money', 'remove-money', 'missions',
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
    expect((await res.json()).data.embeds[0].fields[0].value).toBe('$PEP 5,000')
    expect(findUnique).toHaveBeenCalledWith({ where: { id: USER }, select: { wallet: true } })
  })

  it('routes /add-money to adminAddMoney for ADMIN_ROLE_IDS and Pepperoni Mafia holders only', async () => {
    const adminAddMoney = vi.fn(async (_a: string, _t: string, amount: number) => ({ ok: true, amount, balance: amount }))
    vi.doMock('@/app/lib/pep-admin', async (orig) => ({ ...(await orig<typeof import('@/app/lib/pep-admin')>()), adminAddMoney }))
    const { ADMIN_ROLE_IDS } = await import('@/app/ui/constants')
    const target = '100000000000000009'
    const body = (roles: string[]) => ({
      type: 2,
      guild_id: GUILD,
      member: { user: { id: USER }, roles },
      data: {
        name: 'add-money',
        options: [
          { name: 'member', type: 6, value: target },
          { name: 'amount', type: 4, value: 314 },
          { name: 'reason', type: 3, value: 'mission bonus' },
        ],
        resolved: { users: { [target]: { id: target } }, members: { [target]: { roles: [] } } },
      },
    })
    const denied = await (await post(body(['r1']))).json()
    expect(denied.data.embeds[0].description).toMatch(/Only admins/)
    expect(adminAddMoney).not.toHaveBeenCalled()
    const ok = await (await post(body([ADMIN_ROLE_IDS[0]]))).json()
    expect(adminAddMoney).toHaveBeenCalledWith(USER, target, 314, 'mission bonus')
    expect(ok.data.allowed_mentions).toEqual({ parse: [], users: [target] })
    // No DISCORD_BOT_TOKEN here, so the guild role list is unavailable: the pinned Pepperoni Mafia id applies.
    const mafia = await (await post(body(['823266914834841610']))).json()
    expect(mafia.data.embeds[0].description).toMatch(/^✅ \$PEP added!/)
    expect(adminAddMoney).toHaveBeenCalledTimes(2)
  })

  it('returns an ephemeral error message if the handler throws', async () => {
    doWork.mockRejectedValue(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post({ type: 2, guild_id: GUILD, member: { user: { id: USER } }, data: { name: 'work' } })
    expect(await res.json()).toMatchObject({ type: 4, data: { flags: 64, embeds: [{ color: 0xe74c3c, description: '❌ Something went wrong. Please try again.' }] } })
    spy.mockRestore()
  })

  it('503s when DISCORD_PUBLIC_KEY is not configured', async () => {
    delete process.env.DISCORD_PUBLIC_KEY
    expect((await post({ type: 1 })).status).toBe(503)
  })
})
