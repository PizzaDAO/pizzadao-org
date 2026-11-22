// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nearbyOptOutSig, nearbyOptOutUrl, verifyNearbyOptOut } from './optout'

const KEY = 'UNSUBSCRIBE_SECRET'

describe('nearby opt-out link', () => {
  const had = process.env[KEY]
  beforeEach(() => {
    process.env[KEY] = 'test-secret-0123456789'
  })
  afterEach(() => {
    if (had === undefined) delete process.env[KEY]
    else process.env[KEY] = had
    vi.unstubAllEnvs()
  })

  it('signs and verifies for the member it was made for, and only that member', () => {
    const sig = nearbyOptOutSig('123456789012345678')!
    expect(verifyNearbyOptOut('123456789012345678', sig)).toBe(true)
    expect(verifyNearbyOptOut('123456789012345679', sig)).toBe(false)
    expect(verifyNearbyOptOut('123456789012345678', sig + 'x')).toBe(false)
    expect(verifyNearbyOptOut('123456789012345678', null)).toBe(false)
    expect(verifyNearbyOptOut('not-an-id', sig)).toBe(false)
  })

  it('the URL carries the id and signature', () => {
    const url = nearbyOptOutUrl('123456789012345678', 'https://app.example')!
    expect(url.startsWith('https://app.example/nearby-optout?d=123456789012345678&sig=')).toBe(true)
  })

  it('without a signing secret there is no link and nothing verifies', () => {
    delete process.env[KEY]
    vi.stubEnv('SESSION_SECRET', '')
    expect(nearbyOptOutUrl('123456789012345678', 'https://app.example')).toBeNull()
    expect(verifyNearbyOptOut('123456789012345678', 'abc')).toBe(false)
  })
})
