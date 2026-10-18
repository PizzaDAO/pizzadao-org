import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { syncDiscordMember } from './discord-api'

function mockDiscord(currentNick: string | null) {
  const patches: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)))
        return new Response('{}', { status: 200 })
      }
      return new Response(JSON.stringify({ nick: currentNick, roles: ['r1'] }), { status: 200 })
    }),
  )
  return patches
}

const base = { guildId: 'g', botToken: 't', userId: 'u', turtleRoleIds: [], crewRoleIds: [] }

describe('syncDiscordMember replaceTraineeNickWith (anchovy-52918)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('replaces the Pizza Trainee placeholder with the roster name', async () => {
    const patches = mockDiscord('Pizza Trainee')
    await syncDiscordMember({ ...base, replaceTraineeNickWith: 'Tony Pepperoni' })
    expect(patches[0].nick).toBe('Tony Pepperoni')
  })

  it('leaves a custom nick untouched', async () => {
    const patches = mockDiscord('Custom')
    await syncDiscordMember({ ...base, replaceTraineeNickWith: 'Tony Pepperoni' })
    expect(patches[0]).not.toHaveProperty('nick')
  })

  it('an explicit nickname still wins', async () => {
    const patches = mockDiscord('Pizza Trainee')
    await syncDiscordMember({ ...base, nickname: 'Explicit', replaceTraineeNickWith: 'Tony' })
    expect(patches[0].nick).toBe('Explicit')
  })
})
