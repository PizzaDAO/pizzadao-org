// /capo/review/<slug>: capos vote yes/no (with comments) on generated image candidates.
// Capo (Pizza Capo role) and Dread Pizza Roberts only; the API enforces it too.
import type { Metadata } from 'next'
import Link from 'next/link'
import { getSession } from '@/app/lib/session'
import { imageReviewRole } from '@/app/lib/image-review/access'
import { SLUG_RE } from '@/app/lib/image-review/data'
import ReviewClient from './ReviewClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Art review', robots: { index: false, follow: false } }

export default async function CapoReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getSession()
  const role = session?.discordId ? await imageReviewRole(session.discordId) : null
  if (!role || !SLUG_RE.test(slug)) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
        <div className="text-center">
          <h1 className="text-2xl mb-3">{session ? 'Capos only' : 'Sign in'}</h1>
          <p className="text-foreground/60">{session ? 'This page is for Pizza Capos.' : 'Sign in with Discord to review.'}</p>
          {!session && (
            <Link href={`/login?returnTo=${encodeURIComponent(`/capo/review/${slug}`)}`} className="inline-block mt-4 underline">
              Sign in
            </Link>
          )}
        </div>
      </main>
    )
  }
  return <ReviewClient slug={slug} isOwner={role === 'owner'} />
}
