// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: vi.fn(async () => ({ cached: true, crews: [] })) }))
vi.mock('@/app/lib/calls/access', () => ({ requireCallReviewer: vi.fn(async () => ({ ok: true, session: { discordId: '9' } })) }))
vi.mock('./recordings', () => ({ publishRecording: vi.fn(), unpublishRecording: vi.fn() }))
vi.mock('./recap', () => ({ postCallRecap: vi.fn(async () => 'posted') }))

import { publishRecording } from './recordings'
import { postCallRecap } from './recap'
import { POST } from '@/app/api/admin/calls/[id]/publish/route'

const call = (action: string) =>
  POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify({ action }) }), { params: Promise.resolve({ id: 'rec1' }) })

beforeEach(() => vi.clearAllMocks())

describe('publish route recap', () => {
  it('posts the recap on a fresh publish', async () => {
    vi.mocked(publishRecording).mockResolvedValue('ok')
    const res = await call('publish')
    expect((await res.json()).recap).toBe('posted')
    expect(postCallRecap).toHaveBeenCalledWith('rec1')
  })
  it('re-clicking Publish on an already-published call never posts again', async () => {
    vi.mocked(publishRecording).mockResolvedValue('already')
    const res = await call('publish')
    expect(res.status).toBe(200)
    expect(postCallRecap).not.toHaveBeenCalled()
  })
})
