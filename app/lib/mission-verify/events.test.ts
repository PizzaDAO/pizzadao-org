import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./engine', () => ({ runVerifiers: vi.fn(async () => ({ approved: [], levelsPaid: [], checks: [] })) }))
vi.mock('./notify', () => ({ announceMissionResults: vi.fn(async () => undefined) }))
vi.mock('./policy', () => ({ missionVerifiersEnabled: vi.fn(() => true) }))

import { emitMissionEvent } from './events'
import { runVerifiers } from './engine'

beforeEach(() => vi.clearAllMocks())

describe('emitMissionEvent -> which verifiers re-run', () => {
  it('vouch_received re-runs only the vouch_received mission (L4.2)', async () => {
    await emitMissionEvent('d1', 'vouch_received', { memberId: 'm1' })
    expect(runVerifiers).toHaveBeenCalledWith('d1', { trigger: 'event', verifierKeys: ['vouch_received'], memberId: 'm1' })
  })

  it('connecting a wallet also re-checks the Rare Pizza Box mission (L5.3)', async () => {
    await emitMissionEvent('d1', 'wallet_connected')
    expect(runVerifiers).toHaveBeenCalledWith('d1', { trigger: 'event', verifierKeys: ['wallet_connected', 'rare_pizza_box'] })
  })

  it('giving a vouch still re-checks vouch_given (L5.2)', async () => {
    await emitMissionEvent('d1', 'vouch_created')
    expect(runVerifiers).toHaveBeenCalledWith('d1', { trigger: 'event', verifierKeys: ['vouch_given'] })
  })
})
