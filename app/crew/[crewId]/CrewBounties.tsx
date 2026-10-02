'use client'

// jalapeno-82565 — "Custom Crew Bounties": a crew's open bounties on
// /crew/[crewId]. Kept in its own file so CrewPageClient only gains a
// one-line render per view.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { badge, card } from '@/app/ui/shared-styles'

export type CrewBounty = {
  id: number
  description: string
  link: string | null
  reward: number
  status: 'OPEN' | 'CLAIMED'
  crewId?: string | null
}

/** Only OPEN bounties tagged with this crew, highest reward first. */
export function openCrewBounties(bounties: CrewBounty[], crewId: string): CrewBounty[] {
  return bounties
    .filter((b) => b.status === 'OPEN' && b.crewId === crewId)
    .sort((a, b) => b.reward - a.reward)
}

export function CrewBounties({
  crewId,
  crewLabel,
  hideWhenEmpty = false,
}: {
  crewId: string
  crewLabel: string
  hideWhenEmpty?: boolean
}) {
  // Plain fetch (like the page's manuals fetch) so the crew page doesn't
  // need a react-query provider in tests.
  const [bounties, setBounties] = useState<CrewBounty[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let list: CrewBounty[] = []
      try {
        const res = await fetch(`/api/bounties?crewId=${encodeURIComponent(crewId)}`)
        if (res?.ok) {
          const json = (await res.json()) as { bounties?: CrewBounty[] }
          list = openCrewBounties(Array.isArray(json?.bounties) ? json.bounties : [], crewId)
        }
      } catch {
        // Non-critical section: fall through to the empty state.
      }
      if (!cancelled) setBounties(list)
    })()
    return () => {
      cancelled = true
    }
  }, [crewId])

  if (bounties === null || (hideWhenEmpty && bounties.length === 0)) return null

  return (
    <div style={card()} data-testid="crew-bounties">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          paddingBottom: 12,
          borderBottom: '1px solid hsl(var(--rule) / 0.12)',
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            margin: 0,
            fontFamily: 'var(--font-display), var(--font-sans), system-ui, sans-serif',
            letterSpacing: '-0.01em',
            color: 'hsl(var(--foreground))',
          }}
        >
          Crew Bounties ({bounties.length})
        </h2>
        <Link
          href="/pep"
          style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--tomato))', textDecoration: 'none' }}
        >
          + Post a bounty for {crewLabel}
        </Link>
      </div>

      {bounties.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
          No open bounties for this crew yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {bounties.map((b) => (
            <li
              key={b.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
                padding: 12,
                borderRadius: 'var(--radius)',
                border: '1px solid hsl(var(--rule) / 0.12)',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link
                  href="/pep"
                  style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))', textDecoration: 'none' }}
                >
                  {b.description}
                </Link>
                {b.link && (
                  <div style={{ marginTop: 4 }}>
                    <a
                      href={b.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'hsl(var(--tomato))', wordBreak: 'break-all' }}
                    >
                      {b.link}
                    </a>
                  </div>
                )}
              </div>
              <span style={badge('accent')}>{b.reward.toLocaleString()} PEP</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
