/**
 * The education session flyer: a 1200x630 PNG built with next/og from the same fields the form holds.
 * Used for the live preview, the Discord event cover and the announcement attachment.
 * The renderer's bundled font is Latin-only; other scripts fall back to glyph boxes.
 */
import { ImageResponse } from 'next/og'
import { formatWhen, type SessionTimes } from './build'

export const FLYER_WIDTH = 1200
export const FLYER_HEIGHT = 630

export type FlyerFields = Pick<SessionTimes, 'title' | 'presenter' | 'startsAt' | 'timeZone'>

export function flyerResponse(f: FlyerFields): ImageResponse {
  const size = f.title.length > 60 ? 54 : f.title.length > 36 ? 68 : 84
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          background: '#fbf3e4',
          color: '#2a1a10',
          borderTop: '24px solid #d9432b',
        }}
      >
        <div style={{ display: 'flex', fontSize: 34, letterSpacing: 6, color: '#d9432b' }}>PIZZADAO EDUCATION</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.1 }}>{f.title}</div>
          {f.presenter ? <div style={{ display: 'flex', fontSize: 40, marginTop: 24 }}>{`with ${f.presenter}`}</div> : null}
        </div>
        <div style={{ display: 'flex', fontSize: 38, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex' }}>{formatWhen(f)}</div>
          <div style={{ display: 'flex', fontSize: 64 }}>🍕</div>
        </div>
      </div>
    ),
    { width: FLYER_WIDTH, height: FLYER_HEIGHT },
  )
}

export async function renderFlyerPng(f: FlyerFields): Promise<Buffer> {
  return Buffer.from(await flyerResponse(f).arrayBuffer())
}
