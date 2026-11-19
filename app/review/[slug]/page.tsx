// /review/<slug>: members who completed the minimum level (default 2), capos and Dread Pizza Roberts
// vote yes/no (with comments) on generated image candidates and leave overall feedback.
// The API enforces the same rule. /capo/review/<slug> redirects here.
import type { Metadata } from 'next'
import Link from 'next/link'
import { getSession } from '@/app/lib/session'
import { imageReviewAccess } from '@/app/lib/image-review/access'
import { SLUG_RE } from '@/app/lib/image-review/data'
import ReviewClient from './ReviewClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Art review', robots: { index: false, follow: false } }

export default async function ReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getSession()
  const access = session?.discordId ? await imageReviewAccess(session.discordId) : null
  if (!access?.role || !SLUG_RE.test(slug)) {
    if (!session) {
      return (
        <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
          <div className="text-center">
            <h1 className="text-2xl mb-3">Sign in</h1>
            <p className="text-foreground/60">Sign in with Discord to help pick PizzaDAO art.</p>
            <Link href={`/login?returnTo=${encodeURIComponent(`/review/${slug}`)}`} className="inline-block mt-4 underline">
              Sign in
            </Link>
          </div>
        </main>
      )
    }
    const min = access?.minLevel ?? 2
    const completed = Math.max(0, access?.completed ?? 0)
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
        <section className="text-center grid gap-3 max-w-md" data-testid="review-locked">
          <h1 className="m-0 text-2xl font-bold">Reach level {min} to help pick PizzaDAO art</h1>
          <p className="m-0 text-foreground/70">
            You have completed level {completed} so far. Finish the level {Math.min(min, completed + 1)} missions to keep going.
          </p>
          <div className="mx-auto h-2 w-full max-w-xs overflow-hidden rounded bg-foreground/10" role="progressbar" aria-valuemin={0} aria-valuemax={min} aria-valuenow={Math.min(completed, min)}>
            <div className="h-full bg-foreground" style={{ width: `${Math.min(100, (completed / Math.max(1, min)) * 100)}%` }} />
          </div>
          <Link href="/missions" className="mx-auto rounded border px-4 py-2 font-semibold underline">Go to missions</Link>
        </section>
      </main>
    )
  }
  return <ReviewClient slug={slug} isOwner={access.role === 'owner'} />
}
