/**
 * The education session flyer, built with next/og from the same fields the form holds.
 *  - "post": 1200x630, the preview and the announcement attachment.
 *  - "cover": 1200x480 (2.5:1), the Discord event cover. Discord crops event covers to about 2.5:1, so
 *    the content sits inside a safe area and nothing important touches the edges.
 * No emoji: the renderer would fetch them from a CDN at render time, so the pizza is an inline SVG.
 * The renderer's bundled font is Latin-only; other scripts fall back to glyph boxes.
 */
import { ImageResponse } from 'next/og'
import { formatWhen, type SessionTimes } from './build'

export type FlyerVariant = 'post' | 'cover'
export const FLYER_SIZES: Record<FlyerVariant, { width: number; height: number }> = {
  post: { width: 1200, height: 630 },
  cover: { width: 1200, height: 480 },
}

const RED = '#FE332C'
const BLUE = '#0497C1'
const INK = '#1b1b1f'

export type FlyerFields = Pick<SessionTimes, 'title' | 'presenter' | 'startsAt' | 'timeZone'>

function Pizza({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <path d="M32 60 L6 14 Q32 0 58 14 Z" fill="#F6B73C" />
      <path d="M6 14 Q32 0 58 14 L55 19 Q32 7 9 19 Z" fill="#C8801E" />
      <circle cx="24" cy="24" r="4" fill={RED} />
      <circle cx="39" cy="27" r="4" fill={RED} />
      <circle cx="32" cy="40" r="4" fill={RED} />
    </svg>
  )
}

export function flyerResponse(f: FlyerFields, variant: FlyerVariant = 'post'): ImageResponse {
  const { width, height } = FLYER_SIZES[variant]
  const cover = variant === 'cover'
  const size = f.title.length > 60 ? (cover ? 44 : 54) : f.title.length > 36 ? (cover ? 54 : 68) : cover ? 66 : 84
  const padX = cover ? 120 : 64 // keeps text inside Discord's centre crop on the cover
  const padY = cover ? 56 : 56
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: `${padY}px ${padX}px`,
          background: '#ffffff',
          color: INK,
          borderTop: `20px solid ${RED}`,
          borderBottom: `20px solid ${BLUE}`,
        }}
      >
        <div style={{ display: 'flex', fontSize: cover ? 26 : 32, letterSpacing: 6, color: BLUE }}>PIZZADAO EDUCATION</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.1 }}>{f.title}</div>
          {f.presenter ? <div style={{ display: 'flex', fontSize: cover ? 30 : 40, marginTop: 16, color: RED }}>{`with ${f.presenter}`}</div> : null}
        </div>
        <div style={{ display: 'flex', fontSize: cover ? 28 : 36, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex' }}>{formatWhen(f)}</div>
          <Pizza size={cover ? 56 : 80} />
        </div>
      </div>
    ),
    { width, height },
  )
}

export async function renderFlyerPng(f: FlyerFields, variant: FlyerVariant = 'post'): Promise<Buffer> {
  return Buffer.from(await flyerResponse(f, variant).arrayBuffer())
}
