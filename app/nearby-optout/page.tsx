// Landing page for the signed "not interested in nearby events" link (Telegram invites). Verifies the link,
// then shows one button (a plain form POST, so link scanners that only GET never change anything).
import type { Metadata } from 'next'
import { verifyNearbyOptOut } from '@/app/lib/nearby-events/optout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Nearby event invites',
  robots: { index: false, follow: false },
}

export default async function NearbyOptOutPage({ searchParams }: { searchParams: Promise<{ d?: string; sig?: string; done?: string }> }) {
  const { d, sig, done } = await searchParams
  const valid = verifyNearbyOptOut(d, sig)
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ maxWidth: 440, width: '100%', display: 'grid', gap: 16, padding: 28, borderRadius: 28, background: '#fff', border: '1px solid rgba(0,0,0,0.12)', color: '#1d1a16' }}>
        {!valid ? (
          <p style={{ margin: 0 }}>This link is invalid.</p>
        ) : done === '1' ? (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>Done</h1>
            <p style={{ margin: 0 }}>You won&apos;t get invites to nearby pizza parties any more. You can turn them back on in your profile reminder settings.</p>
          </>
        ) : (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>Nearby pizza parties</h1>
            <p style={{ margin: 0 }}>Press the button to stop getting invites to pizza parties near your city.</p>
            <form method="post" action={`/api/public/nearby-optout?d=${encodeURIComponent(d!)}&sig=${encodeURIComponent(sig!)}`}>
              <button type="submit" style={{ padding: '12px 22px', borderRadius: 999, background: '#1d1a16', color: '#fff', fontWeight: 700, border: 0, cursor: 'pointer' }}>
                Stop nearby invites
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
