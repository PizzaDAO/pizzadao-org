'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Inter } from 'next/font/google'
import { TURTLES } from '@/app/ui/constants'

const inter = Inter({ subsets: ['latin'] })

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
      } catch (e) {
        // Counts are optional, continue without them
      } finally {
        setLoading(false)
      }
    }
    fetchCounts()
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      background: '#fafafa',
      color: '#000',
      fontFamily: inter.style.fontFamily,
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 24 }}>
        {/* Navigation */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/" style={navBtn()}>
            &larr; Home
          </Link>
          <Link href="/crews" style={navBtn()}>
            All Crews
          </Link>
        </div>

        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>Turtle Roles</h1>
          <p style={{ fontSize: 16, opacity: 0.6, marginTop: 8 }}>
            Every PizzaDAO member identifies with one or more turtle roles.
            Click a role to see all members.
          </p>
        </header>

        {/* Turtle Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 16,
        }}>
          {TURTLES.map((t) => {
            const count = counts[t.id]
            return (
              <Link
                key={t.id}
                href={`/turtles/${encodeURIComponent(t.id)}`}
                style={{
                  ...card(),
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)'
                  e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.1)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.06)'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                }}>
                  <img
                    src={t.image}
                    alt={t.label}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'contain',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <h2 style={{
                      fontSize: 20,
                      fontWeight: 700,
                      margin: 0,
                    }}>
                      {t.label}
                    </h2>
                    <p style={{
                      fontSize: 14,
                      opacity: 0.6,
                      margin: '4px 0 0',
                    }}>
                      {t.role}
                    </p>
                    {!loading && count !== undefined && (
                      <p style={{
                        fontSize: 13,
                        color: '#ff4d4d',
                        fontWeight: 600,
                        margin: '6px 0 0',
                      }}>
                        {count} {count === 1 ? 'member' : 'members'}
                      </p>
                    )}
                    {loading && (
                      <p style={{
                        fontSize: 13,
                        opacity: 0.4,
                        margin: '6px 0 0',
                      }}>
                        Loading...
                      </p>
                    )}
                  </div>
                  <span style={{
                    fontSize: 20,
                    opacity: 0.3,
                    flexShrink: 0,
                  }}>
                    &rarr;
                  </span>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 40, opacity: 0.4, fontSize: 13 }}>
          PizzaDAO
        </div>
      </div>
    </div>
  )
}

// Styles
function card(): React.CSSProperties {
  return {
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 14,
    padding: 20,
    boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
    background: 'white',
  }
}

function navBtn(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    background: 'white',
    border: '1px solid rgba(0,0,0,0.15)',
    borderRadius: 8,
    color: '#000',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
  }
}
