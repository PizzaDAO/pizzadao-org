// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn() } }))

import { prisma } from '@/app/lib/db'
import { withLiveItems } from './recordings'

const ZED = '777777777777777'
const seg = { discordId: ZED, startMs: 10_000, endMs: 15_000, text: 'we should order stickers' }
const live = (speakerIds: string[]) => ({ text: 'Order stickers', owner: null, source: 'speech', speakerIds, messageId: null, startMs: 11_000, endMs: 14_000 })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.member.findMany).mockResolvedValue([{ discordId: ZED, name: 'Zed' }] as never)
})

describe('withLiveItems names', () => {
  it('uses the member name when the transcript has none or only "Speaker N"', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([live([ZED])] as never)
    for (const names of [{} as Record<string, string>, { [ZED]: 'Speaker 2' }]) {
      const out = await withLiveItems([], 'sess-1', [seg], [], names)
      expect(out).toEqual([{ text: 'Order stickers', owner: null, suggestedBy: 'Zed' }])
    }
  })

  it('keeps the transcript name when there is one', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([live([ZED])] as never)
    const out = await withLiveItems([], 'sess-1', [seg], [], { [ZED]: 'Zee' })
    expect(out[0].suggestedBy).toBe('Zee')
  })

  it('leaves suggestedBy out when several speakers are possible or no name is known', async () => {
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([live([ZED, '888888888888888'])] as never)
    expect((await withLiveItems([], 'sess-1', [seg], [], {}))[0]).not.toHaveProperty('suggestedBy')
    vi.mocked(prisma.callLiveItem.findMany).mockResolvedValue([live([ZED])] as never)
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as never)
    expect((await withLiveItems([], 'sess-1', [seg], [], {}))[0]).not.toHaveProperty('suggestedBy')
  })
})
