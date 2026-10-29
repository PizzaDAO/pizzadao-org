import { describe, it, expect, vi } from 'vitest'
vi.mock('ai', () => ({ generateText: vi.fn(), Output: { object: vi.fn((o) => o) } }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn() }))

import type { TranscriptSegment } from '@/app/lib/calls/ingest-schema'
import { buildExtractionPrompt, buildSpeakerLabels, makeSourceKey, parseDueDate, parseExtraction } from './extract'

const seg = (discordId: string, startMs: number, text: string): TranscriptSegment => ({ discordId, startMs, endMs: startMs + 1000, text }) as TranscriptSegment
const now = new Date('2026-11-02T12:00:00Z')

const item = (over: Record<string, unknown> = {}) => ({
  ownerName: 'Member A',
  ownerSpeaker: null,
  kind: 'ask_status',
  ask: 'Ask how the plan is going',
  draftMessage: 'Hi! How is the plan going?',
  dueText: null,
  dueDate: null,
  quote: 'Someone should ask Member A',
  startMs: 61000,
  ...over,
})

describe('speaker labels', () => {
  const segments = [seg('900', 5000, 'hello'), seg('100', 1000, 'hi there'), seg('900', 9000, 'more')]
  it('numbers speakers by first appearance and maps back to Discord ids', () => {
    const { labels, byLabel, names } = buildSpeakerLabels(segments, [
      { discordId: '100', displayName: 'Ann' },
      { discordId: '900', displayName: 'Bob' },
    ])
    expect(labels.get('100')).toBe('S1')
    expect(labels.get('900')).toBe('S2')
    expect(byLabel.get('S2')).toBe('900')
    expect(names['100']).toBe('S1 (Ann)')
  })
  it('never puts raw Discord ids in the prompt', () => {
    const { prompt, byLabel } = buildExtractionPrompt({
      segments,
      speakers: [{ discordId: '100', displayName: 'Ann' }, { discordId: '900', displayName: 'Bob' }],
      actionItems: [{ text: 'Do a thing', owner: 'Ann' }],
      today: now,
      recordingId: 'rec1',
    })
    expect(prompt).not.toContain('900')
    expect(prompt).toContain('S2 (Bob)')
    expect(prompt).toContain('Do a thing')
    expect(byLabel.size).toBe(2)
  })
})

describe('parseExtraction', () => {
  const byLabel = new Map([['S3', '333']])

  it('maps the speaker label to a Discord id and keeps the quote and time', () => {
    const [d] = parseExtraction({ items: [item({ ownerSpeaker: 'S3', ownerName: 'Spoke Here' })] }, 'rec1', byLabel, now)
    expect(d).toMatchObject({ speakerDiscordId: '333', ownerName: 'Spoke Here', startMs: 61000, quote: 'Someone should ask Member A', kind: 'ask_status' })
    expect(d.sourceKey).toBe('rec1:61000:spoke-here')
  })
  it('an unknown speaker label becomes null, not an error', () => {
    const [d] = parseExtraction({ items: [item({ ownerSpeaker: 'S9' })] }, 'rec1', byLabel, now)
    expect(d.speakerDiscordId).toBeNull()
  })
  it('drops malformed items but keeps the good ones', () => {
    const out = parseExtraction({ items: [item(), { nonsense: true }, item({ kind: 'bogus' }), item({ ownerName: 'Member B', startMs: 5 })] }, 'rec1', byLabel, now)
    expect(out.map((d) => d.ownerName)).toEqual(['Member A', 'Member B'])
  })
  it('dedupes the same owner at the same moment (idempotent key)', () => {
    const out = parseExtraction({ items: [item(), item({ ask: 'again' })] }, 'rec1', byLabel, now)
    expect(out).toHaveLength(1)
  })
  it('returns nothing for garbage output', () => {
    expect(parseExtraction(null, 'rec1', byLabel, now)).toEqual([])
    expect(parseExtraction('x', 'rec1', byLabel, now)).toEqual([])
    expect(parseExtraction({ items: 'no' }, 'rec1', byLabel, now)).toEqual([])
  })
  it('source keys are stable across spelling noise', () => {
    expect(makeSourceKey('r', 10, 'Álpha  Bravo')).toBe(makeSourceKey('r', 10, 'alpha bravo'))
  })
})

describe('parseDueDate', () => {
  it('accepts a sensible ISO date', () => {
    expect(parseDueDate('2026-11-20', now)?.toISOString().slice(0, 10)).toBe('2026-11-20')
  })
  it('rejects bad, far-past and far-future dates', () => {
    expect(parseDueDate('next friday', now)).toBeNull()
    expect(parseDueDate('2026-13-45', now)).toBeNull()
    expect(parseDueDate('2020-01-01', now)).toBeNull()
    expect(parseDueDate('2030-01-01', now)).toBeNull()
    expect(parseDueDate(null, now)).toBeNull()
  })
})
