'use client'

// Editorial restyle: § overline masthead with the turtle portrait, and
// paper-soft member cards. Data loading is unchanged.

import { use, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { TURTLES } from '@/app/ui/constants'
import { isOptimizableImage } from '@/app/lib/image-hosts'
import {
  EditorialMasthead,
  EditorialPage,
  EmptyState,
  LoadingLine,
  paperCard,
  pillInk,
  pillOutline,
} from '@/app/ui/shared/Editorial'

type TurtleMember = {
  id: string
  name: string
  city: string
  status: string
  turtles: string
  /** Resolved server-side by /api/turtles/[turtleId]. */
  pfpUrl?: string | null
}

type TurtleData = {
  turtle: {
    id: string
    label: string
    role: string
    image: string
  }
  members: TurtleMember[]
  count: number
}

export default function TurtleDetailPage({ params }: { params: Promise<{ turtleId: string }> }) {
  const { turtleId } = use(params)
  const [data, setData] = useState<TurtleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch turtle data
  useEffect(() => {
    async function fetchTurtle() {
      try {
        const res = await fetch(`/api/turtles/${encodeURIComponent(turtleId)}`)
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to load turtle data')
        }
        const json = await res.json()
        setData(json)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    fetchTurtle()
  }, [turtleId])

  if (loading) {
    return (
      <EditorialPage width="max-w-[1000px]">
        <LoadingLine label="Loading turtle members…" />
      </EditorialPage>
    )
  }

  if (error || !data) {
    return (
      <EditorialPage width="max-w-[640px]">
        <div className={`${paperCard} p-7 grid gap-3`} style={{ boxShadow: 'var(--shadow-soft)' }}>
          <p className="overline text-tomato m-0">§ Error</p>
          <h1
            className="font-display font-black tracking-tight text-foreground m-0"
            style={{ fontSize: 'clamp(1.75rem, 5vw, 2.25rem)', lineHeight: 1.05, textWrap: 'balance' }}
          >
            Turtle not found
          </h1>
          <p className="text-muted-foreground m-0">{error || 'Could not load turtle data'}</p>
          <Link href="/turtles" className={`${pillInk} justify-self-start`}>Back to turtles</Link>
        </div>
      </EditorialPage>
    )
  }

  const { turtle, members } = data

  return (
    <EditorialPage width="max-w-[1000px]">
      <EditorialMasthead
        overline="The Turtles"
        title={turtle.label}
        dek={turtle.role}
        aside={
          <Image
            src={turtle.image}
            alt={turtle.label}
            width={96}
            height={96}
            sizes="96px"
            preload
            className="w-24 h-24 object-contain"
          />
        }
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/turtles" className={pillOutline}>
            All turtles
          </Link>
          <span className="overline px-3 py-1.5 rounded-full bg-[hsl(var(--tomato)/0.10)] text-tomato">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </span>
        </div>
      </EditorialMasthead>

      {/* Members Grid */}
      {members.length > 0 ? (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}
        >
          {members.map((member, i) => (
            <div key={member.id || i} className={`${paperCard} p-3.5`}>
              <div className="flex gap-3 items-start">
                {/* Profile Picture */}
                {member.pfpUrl ? (
                  <Image
                    src={member.pfpUrl}
                    alt={member.name}
                    width={44}
                    height={44}
                    sizes="44px"
                    unoptimized={!isOptimizableImage(member.pfpUrl)}
                    className="w-11 h-11 rounded-full object-cover object-top shrink-0 border-2 border-background"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-[hsl(var(--ink)/0.06)] flex items-center justify-center font-display text-lg font-black shrink-0">
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <Link
                      href={`/profile/${member.id}`}
                      className="font-display text-base font-black tracking-tight text-foreground no-underline hover:text-tomato hover:underline transition-colors"
                    >
                      {member.name}
                    </Link>
                    {member.status && (
                      <span
                        className={`overline shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md ${statusBadgeClass(member.status)}`}
                        style={{ fontSize: 10 }}
                      >
                        {member.status}
                      </span>
                    )}
                  </div>
                  {member.city && (
                    <div className="text-[13px] text-foreground/65 mt-0.5">{member.city}</div>
                  )}

                  {/* Other turtle badges */}
                  {member.turtles && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {member.turtles.split(/[,/|]+/).map((tName: string) => {
                        const trimmed = tName.trim()
                        const tDef = TURTLES.find(t =>
                          t.id.toLowerCase() === trimmed.toLowerCase() ||
                          t.label.toLowerCase() === trimmed.toLowerCase()
                        )
                        if (!tDef) return null
                        return (
                          <Link
                            key={tDef.id}
                            href={`/turtles/${encodeURIComponent(tDef.id)}`}
                            title={tDef.label}
                          >
                            <Image
                              src={tDef.image}
                              alt={tDef.label}
                              width={24}
                              height={24}
                              sizes="24px"
                              className="w-6 h-6 object-contain"
                              style={{
                                opacity: tDef.id.toLowerCase() === turtle.id.toLowerCase() ? 1 : 0.5,
                              }}
                            />
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No members with this role yet." />
      )}

      {/* Footer */}
      <div className="rule-warm mt-12 pt-4 text-center">
        <p className="overline m-0 text-foreground/40">§ PizzaDAO</p>
      </div>
    </EditorialPage>
  )
}

function statusBadgeClass(status: string): string {
  const lower = status.toLowerCase()
  if (lower.includes('lead') || lower.includes('capo')) {
    return 'bg-[hsl(var(--tomato)/0.15)] text-tomato'
  }
  if (lower.includes('hot') || lower.includes('active') || lower.includes('daily')) {
    return 'bg-[hsl(122_39%_49%/0.15)] text-[hsl(123_46%_34%)] dark:text-[hsl(122_45%_65%)]'
  }
  if (lower.includes('warm') || lower.includes('weekly')) {
    return 'bg-[hsl(207_90%_54%/0.15)] text-[hsl(210_79%_42%)] dark:text-[hsl(207_90%_70%)]'
  }
  if (lower.includes('cool') || lower.includes('cold')) {
    return 'bg-[hsl(var(--ink)/0.08)] text-muted-foreground'
  }
  return 'bg-[hsl(var(--ink)/0.08)] text-foreground'
}
