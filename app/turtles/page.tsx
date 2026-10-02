'use client'

// Editorial restyle: § overline masthead and paper-soft role cards.
// Data loading (per-turtle member counts) is unchanged.

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { TURTLES } from '@/app/ui/constants'
import { EditorialMasthead, EditorialPage, paperCard, pillOutline } from '@/app/ui/shared/Editorial'

type TurtleCounts = Record<string, number>

export default function TurtlesIndexPage() {
  const [counts, setCounts] = useState<TurtleCounts>({})
  const [loading, setLoading] = useState(true)

  // Fetch member counts for each turtle
  useEffect(() => {
    async function fetchCounts() {
      try {
        const results = await Promise.allSettled(
          TURTLES.map(async (t) => {
            const res = await fetch(`/api/turtles/${encodeURIComponent(t.id)}`)
            if (!res.ok) return { id: t.id, count: 0 }
            const data = await res.json()
            return { id: t.id, count: data.count || 0 }
          })
        )
        const newCounts: TurtleCounts = {}
        for (const result of results) {
          if (result.status === 'fulfilled') {
            newCounts[result.value.id] = result.value.count
          }
        }
        setCounts(newCounts)
      } catch {
        // Counts are optional, continue without them
      } finally {
        setLoading(false)
      }
    }
    fetchCounts()
  }, [])

  return (
    <EditorialPage width="max-w-[960px]">
      <EditorialMasthead
        overline="The Turtles"
        title={
          <>
            Turtle <span className="text-tomato underline-scribble">roles</span>
          </>
        }
        dek="Every PizzaDAO member identifies with one or more turtle roles. Click a role to see all members."
      >
        <nav aria-label="Turtle pages" className="flex flex-wrap gap-2.5">
          <Link href="/crews" className={pillOutline}>
            All crews
          </Link>
        </nav>
      </EditorialMasthead>

      {/* Turtle Grid */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))' }}
      >
        {TURTLES.map((t) => {
          const count = counts[t.id]
          return (
            <Link
              key={t.id}
              href={`/turtles/${encodeURIComponent(t.id)}`}
              className={`${paperCard} group p-5 no-underline text-inherit transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--tomato)/0.6)]`}
              style={{ boxShadow: 'var(--shadow-soft)' }}
            >
              <div className="flex items-center gap-4">
                <Image
                  src={t.image}
                  alt={t.label}
                  width={64}
                  height={64}
                  sizes="64px"
                  className="w-16 h-16 object-contain shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <h2
                    className="font-display font-black tracking-tight text-foreground leading-tight m-0 group-hover:text-tomato transition-colors"
                    style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.4rem)', textWrap: 'balance' }}
                  >
                    {t.label}
                  </h2>
                  <p className="text-sm text-foreground/60 mt-1 mb-0">{t.role}</p>
                  {!loading && count !== undefined && (
                    <p className="overline text-tomato mt-2 mb-0">
                      {count} {count === 1 ? 'member' : 'members'}
                    </p>
                  )}
                  {loading && (
                    <p className="overline text-foreground/40 mt-2 mb-0">Loading…</p>
                  )}
                </div>
                <span aria-hidden className="text-xl text-foreground/30 shrink-0 group-hover:text-tomato transition-colors">
                  &rarr;
                </span>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Footer */}
      <div className="rule-warm mt-12 pt-4 text-center">
        <p className="overline m-0 text-foreground/40">§ PizzaDAO</p>
      </div>
    </EditorialPage>
  )
}
