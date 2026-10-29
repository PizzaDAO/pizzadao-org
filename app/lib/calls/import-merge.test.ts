// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { MAX_TURN_CHARS, chunkText, mergeTranscript, parseRttm, parseWhisperJson, speakerFor, UNKNOWN_SPEAKER, type DiarTurn, type WhisperSeg } from './import-merge'

const tok = (text: string, startMs: number, endMs: number, p = 0.9) => ({ text, startMs, endMs, p })
const seg = (startMs: number, endMs: number, text: string, tokens = [] as WhisperSeg['tokens']): WhisperSeg => ({ startMs, endMs, text, tokens })

describe('parseRttm', () => {
  it('reads SPEAKER lines in ms and sorts them', () => {
    const rttm = ['SPEAKER f 1 5.000 2.500 <NA> <NA> B <NA> <NA>', 'SPEAKER f 1 0.000 4.000 <NA> <NA> A <NA> <NA>', 'junk', 'SPEAKER f 1 9 0 <NA> <NA> C <NA> <NA>'].join('\n')
    expect(parseRttm(rttm)).toEqual([
      { startMs: 0, endMs: 4000, speaker: 'A' },
      { startMs: 5000, endMs: 7500, speaker: 'B' },
    ])
  })
})

describe('parseWhisperJson', () => {
  it('reads offsets and tokens, skipping special tokens and bad rows', () => {
    const json = {
      transcription: [
        {
          offsets: { from: 1000, to: 3000 },
          text: ' Hello there',
          tokens: [
            { text: '[_BEG_]', offsets: { from: 1000, to: 1000 }, p: 0.9 },
            { text: ' Hello', offsets: { from: 1000, to: 1800 }, p: 0.9 },
            { text: ' there', offsets: { from: 1800, to: 3000 }, p: 0.8 },
          ],
        },
        { text: 'no offsets' },
      ],
    }
    const out = parseWhisperJson(json)
    expect(out).toHaveLength(1)
    expect(out[0].tokens.map((t) => t.text)).toEqual([' Hello', ' there'])
    expect(out[0].avgLogprob).toBeLessThan(0)
    expect(parseWhisperJson(null)).toEqual([])
  })
})

describe('speakerFor', () => {
  const turns: DiarTurn[] = [
    { startMs: 0, endMs: 5000, speaker: 'A' },
    { startMs: 5000, endMs: 10000, speaker: 'B' },
  ]
  it('picks the largest overlap', () => {
    expect(speakerFor(turns, 3000, 9000)).toBe('B')
    expect(speakerFor(turns, 0, 4000)).toBe('A')
  })
  it('falls back to the nearest turn within a second, else null', () => {
    expect(speakerFor(turns, 10400, 11000)).toBe('B')
    expect(speakerFor(turns, 12000, 13000)).toBeNull()
  })
})

describe('mergeTranscript', () => {
  const turns: DiarTurn[] = [
    { startMs: 0, endMs: 10000, speaker: 'SPEAKER_01' },
    { startMs: 10000, endMs: 20000, speaker: 'SPEAKER_00' },
  ]

  it('assigns xs:N by first appearance and joins close lines of one speaker', () => {
    const r = mergeTranscript({
      turns,
      segments: [seg(1000, 3000, ' Welcome everyone.'), seg(3200, 6000, ' Let us start.'), seg(11000, 14000, ' Thanks for having me.')],
    })
    expect(r.segments).toEqual([
      { discordId: 'xs:1', startMs: 1000, endMs: 6000, text: 'Welcome everyone. Let us start.', kind: 'speech' },
      { discordId: 'xs:2', startMs: 11000, endMs: 14000, text: 'Thanks for having me.', kind: 'speech' },
    ])
    expect(r.speakers).toEqual([
      { id: 'xs:1', label: 'SPEAKER_01', talkTimeSec: 10 },
      { id: 'xs:2', label: 'SPEAKER_00', talkTimeSec: 10 },
    ])
  })

  it('splits a segment at a speaker change using token times', () => {
    const r = mergeTranscript({
      turns,
      segments: [
        seg(8000, 13000, ' one two three four', [tok(' one', 8000, 8800), tok(' two', 8800, 9500), tok(' three', 10500, 11500), tok(' four', 11500, 12500)]),
      ],
    })
    expect(r.segments.map((s) => [s.discordId, s.text])).toEqual([
      ['xs:1', 'one two'],
      ['xs:2', 'three four'],
    ])
  })

  it('absorbs a one-word flip inside one speaker turn', () => {
    const r = mergeTranscript({
      turns,
      segments: [seg(1000, 6000, ' a b c', [tok(' a', 1000, 2000), tok(' b', 10100, 10900), tok(' c', 3000, 4000)])],
    })
    expect(r.segments).toHaveLength(1)
  })

  it('gives text no turn explains the unknown speaker xs:0', () => {
    const r = mergeTranscript({ turns, segments: [seg(30000, 32000, ' Hello from nowhere.')] })
    expect(r.segments[0].discordId).toBe(UNKNOWN_SPEAKER)
    expect(r.stats.unattributed).toBe(1)
  })

  it('drops repeat runs and low-confidence segments', () => {
    const loop = [seg(1000, 2000, ' thank you'), seg(2000, 3000, ' thank you'), seg(3000, 4000, ' thank you')]
    const dubious: WhisperSeg = { ...seg(5000, 6000, ' garbage'), avgLogprob: -2 }
    const r = mergeTranscript({ turns, segments: [...loop, dubious, seg(7000, 8000, ' Real words here.')] })
    expect(r.segments.map((s) => s.text)).toEqual(['Real words here.'])
    expect(r.stats.droppedRepeats).toBe(3)
    expect(r.stats.droppedDubious).toBe(1)
  })

  it('clamps to the recording length and counts words, never storing more than the text', () => {
    const r = mergeTranscript({ turns, segments: [seg(1000, 9000, ' inside'), seg(19000, 25000, ' runs over'), seg(40000, 41000, ' beyond')], durationMs: 20000 })
    expect(r.segments.map((s) => s.text)).toEqual(['inside', 'runs over'])
    expect(r.segments[1].endMs).toBe(20000)
    expect(r.stats.words).toBe(3)
  })
})

describe('long monologues', () => {
  const sentence = 'This is one sentence of a very long talk by a single speaker.'
  it('never makes a segment longer than the cap: ten minutes of one speaker', () => {
    // 10 minutes, a 6 s line every 7 s (about 85 lines, 1 s apart), all one speaker.
    const segs: WhisperSeg[] = Array.from({ length: 85 }, (_, i) => seg(i * 7000, i * 7000 + 6000, ` Part ${i}. ${sentence} ${sentence} ${sentence} ${sentence} ${sentence} ${sentence}`))
    const r = mergeTranscript({ turns: [{ startMs: 0, endMs: 600_000, speaker: 'A' }], segments: segs, durationMs: 600_000 })
    expect(r.segments.length).toBeGreaterThan(1)
    expect(r.segments.every((s) => s.text.length <= MAX_TURN_CHARS && s.discordId === 'xs:1')).toBe(true)
    // nothing is lost and the order is kept
    expect(r.segments.map((s) => s.text).join(' ').split(sentence).length - 1).toBe(85 * 6)
    expect(r.segments.every((s, i) => i === 0 || s.startMs >= r.segments[i - 1].startMs)).toBe(true)
  })
  it('splits one huge line at sentence ends with proportional times', () => {
    const big = Array.from({ length: 200 }, () => sentence).join(' ')
    const r = mergeTranscript({ turns: [{ startMs: 0, endMs: 100_000, speaker: 'A' }], segments: [seg(0, 100_000, ` ${big}`)] })
    expect(r.segments.length).toBeGreaterThan(3)
    expect(r.segments.every((s) => s.text.length <= MAX_TURN_CHARS && s.text.endsWith('.'))).toBe(true)
    expect(r.segments[0].startMs).toBe(0)
    expect(r.segments[r.segments.length - 1].endMs).toBe(100_000)
  })
  it('hard-splits a single word longer than the cap', () => {
    expect(chunkText('x'.repeat(7000), 3000).map((c) => c.length)).toEqual([3000, 3000, 1000])
  })
})
