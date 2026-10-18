/**
 * Minimal Ogg/Opus muxer (RFC 7845). prism-media 1.x has no Ogg writer, and a
 * file that streams to disk page by page is what makes recording crash-safe.
 *
 * Input: raw 20 ms Opus packets (objectMode Buffers, exactly what
 * @discordjs/voice's receive stream yields). Output: Ogg bytes. Pages are
 * flushed every `packetsPerPage` packets, so at most ~200 ms is in memory.
 */
import { Transform, type TransformCallback } from 'node:stream'

const SAMPLES_PER_PACKET = 960 // 20 ms at 48 kHz
const PRE_SKIP = 312
const SERIAL = 0x50495a41 // arbitrary

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    t[i] = r >>> 0
  }
  return t
})()

export function oggCrc(buf: Buffer): number {
  let crc = 0
  for (const b of buf) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0
  return crc >>> 0
}

/** Lacing values for one packet (a packet of 255*k bytes needs a trailing 0). */
function lacing(len: number): number[] {
  const out = new Array<number>(Math.floor(len / 255)).fill(255)
  out.push(len % 255)
  return out
}

export function buildPage(opts: { type: number; granule: bigint; seq: number; packets: Buffer[] }): Buffer {
  const table = opts.packets.flatMap((p) => lacing(p.length))
  if (table.length > 255) throw new Error('too many segments for one Ogg page')
  const header = Buffer.alloc(27 + table.length)
  header.write('OggS', 0, 'latin1')
  header.writeUInt8(0, 4) // version
  header.writeUInt8(opts.type, 5)
  header.writeBigUInt64LE(opts.granule < 0n ? 0xffffffffffffffffn : opts.granule, 6)
  header.writeUInt32LE(SERIAL, 14)
  header.writeUInt32LE(opts.seq, 18)
  header.writeUInt32LE(0, 22) // crc placeholder
  header.writeUInt8(table.length, 26)
  Buffer.from(table).copy(header, 27)
  const page = Buffer.concat([header, ...opts.packets])
  page.writeUInt32LE(oggCrc(page), 22)
  return page
}

function opusHead(channels: number): Buffer {
  const b = Buffer.alloc(19)
  b.write('OpusHead', 0, 'latin1')
  b.writeUInt8(1, 8) // version
  b.writeUInt8(channels, 9)
  b.writeUInt16LE(PRE_SKIP, 10)
  b.writeUInt32LE(48000, 12)
  b.writeInt16LE(0, 16) // output gain
  b.writeUInt8(0, 18) // mapping family 0
  return b
}

function opusTags(): Buffer {
  const vendor = Buffer.from('pizzadao-call-recorder', 'utf8')
  const b = Buffer.alloc(8 + 4 + vendor.length + 4)
  b.write('OpusTags', 0, 'latin1')
  b.writeUInt32LE(vendor.length, 8)
  vendor.copy(b, 12)
  b.writeUInt32LE(0, 12 + vendor.length) // no user comments
  return b
}

export class OggOpusWriter extends Transform {
  private seq = 0
  private samples = 0n
  private pending: Buffer[] = []
  private headerWritten = false

  constructor(
    private readonly channels = 2,
    private readonly packetsPerPage = 10,
  ) {
    super({ writableObjectMode: true })
  }

  private writeHeaders() {
    if (this.headerWritten) return
    this.headerWritten = true
    this.push(buildPage({ type: 0x02, granule: 0n, seq: this.seq++, packets: [opusHead(this.channels)] }))
    this.push(buildPage({ type: 0x00, granule: 0n, seq: this.seq++, packets: [opusTags()] }))
  }

  private flushPage(eos: boolean) {
    if (this.pending.length === 0 && !eos) return
    this.push(
      buildPage({
        type: eos ? 0x04 : 0x00,
        granule: BigInt(PRE_SKIP) + this.samples,
        seq: this.seq++,
        packets: this.pending,
      }),
    )
    this.pending = []
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.writeHeaders()
    this.pending.push(chunk)
    this.samples += BigInt(SAMPLES_PER_PACKET)
    if (this.pending.length >= this.packetsPerPage) this.flushPage(false)
    cb()
  }

  override _flush(cb: TransformCallback): void {
    this.writeHeaders()
    this.flushPage(true)
    cb()
  }
}
