// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { linkPatch } from './CallFollowUpLinks'

describe('CallFollowUpLinks patch', () => {
  const row = { actionKey: 'aaaaaaaa', doneUrl: 'https://example.org/done' }

  it('sends nothing when nothing changed', () => {
    expect(linkPatch(row, 'aaaaaaaa', 'https://example.org/done')).toEqual({})
    expect(linkPatch({ actionKey: null, doneUrl: null }, '', '  ')).toEqual({})
  })

  it('sends only the field that changed', () => {
    expect(linkPatch(row, 'bbbbbbbb', 'https://example.org/done')).toEqual({ actionKey: 'bbbbbbbb' })
    expect(linkPatch(row, 'aaaaaaaa', ' https://example.org/other ')).toEqual({ doneUrl: 'https://example.org/other' })
  })

  it('unlinking and clearing send null', () => {
    expect(linkPatch(row, '', '')).toEqual({ actionKey: null, doneUrl: null })
  })
})
