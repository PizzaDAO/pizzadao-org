import { describe, expect, it } from 'vitest'
import { buildPage, oggCrc, OggOpusWriter } from './ogg-opus.js'
import { OPUS_SILENCE_FRAME } from './gap-filler.js'

async function mux(packets: Buffer[], perPage = 10): Promise<Buffer> {
  const w = new OggOpusWriter(2, perPage)
  const chunks: Buffer[] = []
  w.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((r) => w.on('end', () => r()))
  for (const p of packets) w.write(p)
  w.end()
  await done
  return Buffer.concat(chunks)
}

interface Page {
  type: number
  granule: bigint
  seq: number
  crcOk: boolean
  segments: number[]
}

function parsePages(buf: Buffer): Page[] {
  const pages: Page[] = []
  let o = 0
  while (o < buf.length) {
    expect(buf.toString('latin1', o, o + 4)).toBe('OggS')
    const n = buf.readUInt8(o + 26)
    const segments = [...buf.subarray(o + 27, o + 27 + n)]
    const size = 27 + n + segments.reduce((a, b) => a + b, 0)
    const page = Buffer.from(buf.subarray(o, o + size))
    const crc = page.readUInt32LE(22)
    page.writeUInt32LE(0, 22)
    pages.push({
      type: buf.readUInt8(o + 5),
      granule: buf.readBigUInt64LE(o + 6),
      seq: buf.readUInt32LE(o + 18),
      crcOk: oggCrc(page) === crc,
      segments,
    })
    o += size
  }
  return pages
}

describe('OggOpusWriter', () => {
  it('writes OpusHead (BOS), OpusTags, audio pages and an EOS page, all with valid CRCs', async () => {
    const pages = parsePages(await mux(Array.from({ length: 25 }, () => OPUS_SILENCE_FRAME)))
    expect(pages.map((p) => p.seq)).toEqual([0, 1, 2, 3, 4])
    expect(pages[0].type).toBe(0x02)
    expect(pages.at(-1)!.type).toBe(0x04)
    expect(pages.every((p) => p.crcOk)).toBe(true)
    // 25 packets * 960 samples + 312 pre-skip
    expect(pages.at(-1)!.granule).toBe(BigInt(25 * 960 + 312))
    expect(pages[2].segments).toHaveLength(10)
  })

  it('still produces a valid file for an empty stream', async () => {
    const pages = parsePages(await mux([]))
    expect(pages.length).toBe(3)
    expect(pages.every((p) => p.crcOk)).toBe(true)
  })

  it('laces packets of 255*k bytes with a terminating zero', () => {
    const page = buildPage({ type: 0, granule: 0n, seq: 0, packets: [Buffer.alloc(510, 1), Buffer.alloc(300, 2)] })
    const [p] = parsePages(page)
    expect(p.segments).toEqual([255, 255, 0, 255, 45])
    expect(p.crcOk).toBe(true)
  })
})
