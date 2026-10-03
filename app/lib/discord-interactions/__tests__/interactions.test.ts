// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyDiscordRequest } from '../verify'
import { handleInteraction, type HandlerDeps } from '../handle'
import { PEP_COMMANDS } from '../commands'

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
  const deps = (over: Partial<HandlerDeps> = {}): HandlerDeps => ({
    guildId: GUILD,
    getWallet: vi.fn(async (id: string) => (id === USER ? 1234 : 7)),
    doWork: vi.fn(async () => ({ ok: true as const, amount: 42, balance: 1276, prompt: 'You folded boxes: {amount}.' })),
    currency: '<:pepperoni:973304305979367444>',
    ...over,
  })
  const cmd = (name: string, options?: Array<{ name: string; type: number; value: unknown }>) => ({
    type: 2,
    guild_id: GUILD,
    member: { user: { id: USER } },
    data: { name, options },
  })

  it('answers PING with PONG', async () => {
    expect(await handleInteraction({ type: 1 }, deps())).toEqual({ type: 1 })
  })

  it('/balance replies ephemerally for self and for another member, without pings', async () => {
    const self = await handleInteraction(cmd('balance'), deps())
    expect(self.data).toMatchObject({ content: expect.stringContaining('**1,234**'), flags: 64, allowed_mentions: { parse: [] } })
    const other = await handleInteraction(cmd('balance', [{ name: 'member', type: 6, value: '100000000000000009' }]), deps())
    expect(other.data?.content).toBe('<@100000000000000009> has <:pepperoni:973304305979367444> **7**')
  })

  it('/work posts the prompt with the amount filled in', async () => {
    const r = await handleInteraction(cmd('work'), deps())
    expect(r.data?.flags).toBeUndefined()
    expect(r.data?.content).toBe('You folded boxes: <:pepperoni:973304305979367444> **42**.\nBalance: <:pepperoni:973304305979367444> 1,276')
  })

  it('/work on cooldown replies ephemerally with a Discord relative timestamp', async () => {
    const r = await handleInteraction(cmd('work'), deps({ doWork: vi.fn(async () => ({ ok: false as const, readyAt: new Date(1_800_000_000_500) })) }))
    expect(r.data).toMatchObject({ flags: 64, content: expect.stringContaining('<t:1800000001:R>') })
  })

  it('refuses other guilds and DMs, and unknown commands', async () => {
    expect((await handleInteraction({ ...cmd('work'), guild_id: '1' }, deps())).data?.content).toMatch(/only work in the PizzaDAO server/)
    expect((await handleInteraction({ ...cmd('work'), guild_id: undefined }, deps())).data?.content).toMatch(/only work/)
    expect((await handleInteraction(cmd('rob'), deps())).data?.content).toBe('Unknown command.')
  })

  it('registers only commands that have handlers', () => {
    expect(PEP_COMMANDS.map((c) => c.name)).toEqual(['balance', 'work'])
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
