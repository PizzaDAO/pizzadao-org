'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { Inter } from 'next/font/google'
import { TURTLES } from '@/app/ui/constants'

const inter = Inter({ subsets: ['latin'] })

type TurtleMember = {
  id: string
  name: string
  city: string
  status: string
  turtles: string
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
  const [pfpUrls, setPfpUrls] = useState<Record<string, string>>({})

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
        setError((e as any)?.message)
      } finally {
        setLoading(false)
      }
    }
    fetchTurtle()
  }, [turtleId])

  // Fetch profile pictures for all members
  useEffect(() => {
    if (!data?.members?.length) return

    async function fetchPfps() {
      const urls: Record<string, string> = {}
      // Fetch in batches to avoid too many concurrent requests
      const batchSize = 10
      for (let i = 0; i < data!.members.length; i += batchSize) {
        const batch = data!.members.slice(i, i + batchSize)
        const results = await Promise.allSettled(
          batch.map(async (m) => {
            if (!m.id) return null
            const res = await fetch(`/api/pfp/${m.id}`)
            if (!res.ok) return null
            const json = await res.json()
            return { id: m.id, url: json.url }
          })
        )
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value?.url) {
            urls[result.value.id] = result.value.url
          }
        }
      }
      setPfpUrls(urls)
    }
    fetchPfps()
  }, [data])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-page-bg)',
        fontFamily: inter.style.fontFamily,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 50,
            height: 50,
            border: '4px solid var(--color-spinner-track)',
            borderTop: '4px solid var(--color-spinner-active)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px',
          }} />
          <p style={{ fontSize: 18, opacity: 0.8 }}>Loading turtle members...</p>
          <style jsx>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-page-bg)',
        fontFamily: inter.style.fontFamily,
        padding: 20,
      }}>
        <div style={card()}>
          <h1 style={{ fontSize: 24, marginBottom: 16 }}>Turtle Not Found</h1>
          <p style={{ opacity: 0.7, marginBottom: 32 }}>{error || 'Could not load turtle data'}</p>
          <Link href="/turtles" style={btn('primary')}>Back to Turtles</Link>
        </div>
      </div>
    )
  }

  const { turtle, members } = data

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-page-bg)',
      color: 'var(--color-text)',
      fontFamily: inter.style.fontFamily,
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 24 }}>
        {/* Navigation */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/" style={navBtn()}>
            &larr; Home
          </Link>
          <Link href="/turtles" style={navBtn()}>
            All Turtles
          </Link>
        </div>

        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 20 }}>
          <img
            src={turtle.image}
            alt={turtle.label}
            style={{
              width: 96,
              height: 96,
              objectFit: 'contain',
              margin: '0 auto 16px',
              display: 'block',
            }}
          />
          <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>
            {turtle.label}
          </h1>
          <p style={{ fontSize: 18, opacity: 0.6, marginTop: 8 }}>
            {turtle.role}
          </p>
          <span style={{
            display: 'inline-block',
            marginTop: 12,
            padding: '6px 16px',
            borderRadius: 20,
            background: 'rgba(255,77,77,0.1)',
            color: '#ff4d4d',
            fontSize: 14,
            fontWeight: 600,
          }}>
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </span>
        </header>

        {/* Members Grid */}
        {members.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}>
            {members.map((member, i) => (
              <div key={member.id || i} style={memberCard()}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {/* Profile Picture */}
                  {pfpUrls[member.id] ? (
                    <img
                      src={pfpUrls[member.id]}
                      alt={member.name}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        objectFit: 'cover',
                        objectPosition: 'top',
                        flexShrink: 0,
                        border: '2px solid #fafafa',
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <div style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      flexShrink: 0,
                    }}>
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Link
                        href={`/profile/${member.id}`}
                        style={{
                          fontWeight: 700,
                          fontSize: 16,
                          color: 'inherit',
                          textDecoration: 'none',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                        onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                      >
                        {member.name}
                      </Link>
                      {member.status && (
                        <span style={statusBadge(member.status)}>{member.status}</span>
                      )}
                    </div>
                    {member.city && (
                      <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>
                        {member.city}
                      </div>
                    )}

                    {/* Other turtle badges */}
                    {member.turtles && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
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
                              <img
                                src={tDef.image}
                                alt={tDef.label}
                                style={{
                                  width: 24,
                                  height: 24,
                                  objectFit: 'contain',
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
          <div style={{
            ...card(),
            textAlign: 'center',
            padding: 40,
          }}>
            <p style={{ fontSize: 16, opacity: 0.6 }}>
              No members with this role yet.
            </p>
          </div>
        )}

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
    border: '1px solid var(--color-border)',
    borderRadius: 14,
    padding: 24,
    boxShadow: 'var(--shadow-card)',
    background: 'var(--color-surface)',
  }
}

function navBtn(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 8,
    color: 'var(--color-text)',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
  }
}

function btn(kind: 'primary' | 'secondary'): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '10px 16px',
    borderRadius: 10,
    border: '1px solid var(--color-border-strong)',
    fontWeight: 650,
    cursor: 'pointer',
    textDecoration: 'none',
    textAlign: 'center',
  }
  if (kind === 'primary') return { ...base, background: 'var(--color-btn-primary-bg)', color: 'var(--color-btn-primary-text)', borderColor: 'var(--color-btn-primary-border)' }
  return { ...base, background: 'var(--color-surface)', color: 'var(--color-text)' }
}

function memberCard(): React.CSSProperties {
  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
  }
}

function statusBadge(status: string): React.CSSProperties {
  const lower = status.toLowerCase()
  let bg = 'rgba(0,0,0,0.1)'
  let color = '#333'

  if (lower.includes('lead') || lower.includes('capo')) {
    bg = 'rgba(255,77,77,0.15)'
    color = '#d32f2f'
  } else if (lower.includes('hot') || lower.includes('active') || lower.includes('daily')) {
    bg = 'rgba(76,175,80,0.15)'
    color = '#2e7d32'
  } else if (lower.includes('warm') || lower.includes('weekly')) {
    bg = 'rgba(33,150,243,0.15)'
    color = '#1565c0'
  } else if (lower.includes('cool') || lower.includes('cold')) {
    bg = 'rgba(158,158,158,0.15)'
    color = '#757575'
  }

  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    background: bg,
    color: color,
    textTransform: 'uppercase',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  }
}
