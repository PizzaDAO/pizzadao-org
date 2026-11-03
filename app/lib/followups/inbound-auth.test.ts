import { describe, expect, it } from 'vitest'
import { inboundSource } from './inbound-auth'

const env = { FOLLOWUP_INBOUND_TELEGRAM_KEY: 'tg-key-1', RECORDER_API_KEY: 'rec-key-1' } as unknown as NodeJS.ProcessEnv

describe('inboundSource', () => {
  it('the key decides the source', () => {
    expect(inboundSource('Bearer tg-key-1', env)).toBe('telegram')
    expect(inboundSource('Bearer rec-key-1', env)).toBe('discord')
  })
  it('rejects wrong, missing and malformed credentials', () => {
    expect(inboundSource('Bearer nope', env)).toBeNull()
    expect(inboundSource('tg-key-1', env)).toBeNull()
    expect(inboundSource(null, env)).toBeNull()
    expect(inboundSource('', env)).toBeNull()
  })
  it('fails closed when a key is not configured', () => {
    expect(inboundSource('Bearer ', {} as NodeJS.ProcessEnv)).toBeNull()
    expect(inboundSource('Bearer rec-key-1', { FOLLOWUP_INBOUND_TELEGRAM_KEY: 'tg-key-1' } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })
  it('refuses a key shared by both callers (it cannot tell them apart)', () => {
    expect(inboundSource('Bearer same', { FOLLOWUP_INBOUND_TELEGRAM_KEY: 'same', RECORDER_API_KEY: 'same' } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })
})
