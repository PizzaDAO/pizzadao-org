'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Inter } from 'next/font/google'
import { groupCrewsByDay } from '@/app/lib/crew-schedule'
import {
  btn,
  card,
  loadingSpinner,
  navBtn,
  pageContainer,
} from '@/app/ui/shared-styles'

const inter = Inter({ subsets: ['latin'] })

type CrewTask = {
  label: string
  url?: string
  priority?: string
}

type CrewOption = {
  id: string
  label: string
  emoji?: string
  callTime?: string
  callTimeUrl?: string
  callLength?: string
  channel?: string
  role?: string
  sheet?: string
  tasks?: CrewTask[]
  taskCount?: number
}

type UserData = {
  memberId: string
  name: string
  crews: string[]
  discordId?: string
}

export default function AllCrewsPage() {
  const [crews, setCrews] = useState<CrewOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<UserData | null>(null)
  const [joining, setJoining] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile viewport
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Fetch crews and user data
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch crews
        const crewsRes = await fetch('/api/crew-mappings')
        if (!crewsRes.ok) throw new Error('Failed to load crews')
        const crewsData = await crewsRes.json()
        setCrews(crewsData.crews || [])

        // Fetch current user
        const meRes = await fetch('/api/me')
        if (meRes.ok) {
          const meData = await meRes.json()
          if (meData.memberId) {
            // Fetch user's crews from their profile
            const profileRes = await fetch(`/api/profile/${meData.memberId}`)
            if (profileRes.ok) {
              const profileData = await profileRes.json()
              const userCrews = profileData.Crews
                ? profileData.Crews.split(',').map((c: string) => c.trim().toLowerCase()).filter(Boolean)
                : []
              setUser({
                memberId: meData.memberId,
                name: meData.name || profileData.Name,
                crews: userCrews,
                discordId: meData.discordId,
              })
            }
          }
        }
      } catch (e: unknown) {
        setError((e as any)?.message)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Group crews by day of week, separating "Other" crews
  const crewsByDay = useMemo(() => groupCrewsByDay(crews), [crews])
  const scheduledCrews = useMemo(() => crewsByDay.filter(g => g.day !== 'Other'), [crewsByDay])
  const otherCrews = useMemo(() => crewsByDay.find(g => g.day === 'Other')?.crews ?? [], [crewsByDay])

  const handleJoinCrew = async (crewId: string) => {
    if (!user) {
      alert('Please log in to join a crew')
      return
    }

    setJoining(crewId)
    try {
      const res = await fetch('/api/join-crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crewId, action: 'join' }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to join crew')

      // Update local state
      setUser(prev => prev ? {
        ...prev,
        crews: [...prev.crews, crewId.toLowerCase()]
      } : null)

    } catch (e: unknown) {
      alert((e as any)?.message)
    } finally {
      setJoining(null)
    }
  }

  const handleLeaveCrew = async (crewId: string) => {
    if (!user) return

    setLeaving(crewId)
    try {
      const res = await fetch('/api/join-crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crewId, action: 'leave' }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to leave crew')

      // Update local state
      setUser(prev => prev ? {
        ...prev,
        crews: prev.crews.filter(c => c.toLowerCase() !== crewId.toLowerCase())
      } : null)

    } catch (e: unknown) {
      alert((e as any)?.message)
    } finally {
      setLeaving(null)
    }
  }

  const isInCrew = (crewId: string) => {
    if (!user) return false
    return user.crews.some(c => c.toLowerCase() === crewId.toLowerCase())
  }

  const renderCrewCard = (crew: CrewOption) => {
    const inCrew = isInCrew(crew.id)
    const isJoining = joining === crew.id
    const isLeaving = leaving === crew.id

    return (
      <div key={crew.id} style={{
        ...card(),
        padding: 20,
        border: inCrew ? '2px solid hsl(var(--tomato))' : '1px solid hsl(var(--rule) / 0.12)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                margin: 0,
                textWrap: 'balance',
              } as React.CSSProperties}
            >
              {crew.emoji && `${crew.emoji} `}{crew.label}
            </h2>
            {(crew.callTime || crew.callLength) && (
              <p style={{ fontSize: 14, opacity: 0.7, margin: '8px 0 0' }}>
                {crew.callTime && (
                  crew.callTimeUrl ? (
                    <a href={crew.callTimeUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                      {crew.callTime}
                    </a>
                  ) : crew.callTime
                )}
                {crew.callTime && crew.callLength && ' \u2022 '}
                {crew.callLength}
              </p>
            )}
          </div>
          {inCrew && (
            <span style={{
              background: 'hsl(var(--tomato) / 0.12)',
              color: 'hsl(var(--tomato))',
              padding: '4px 10px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 600,
            }}>
              Joined
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Link
            href={`/crew/${crew.id}`}
            style={{
              ...btn('secondary'),
              flex: 1,
              textAlign: 'center',
              fontSize: 14,
            }}
          >
            View Crew
          </Link>

          {user && (
            inCrew ? (
              <button
                onClick={() => handleLeaveCrew(crew.id)}
                disabled={isLeaving}
                style={{
                  ...btn('secondary'),
                  flex: 1,
                  fontSize: 14,
                  opacity: isLeaving ? 0.6 : 1,
                  cursor: isLeaving ? 'wait' : 'pointer',
                  color: 'hsl(var(--destructive))',
                  borderColor: 'hsl(var(--destructive) / 0.5)',
                }}
              >
                {isLeaving ? 'Leaving...' : 'Leave Crew'}
              </button>
            ) : (
              <button
                onClick={() => handleJoinCrew(crew.id)}
                disabled={isJoining}
                style={{
                  ...btn('primary'),
                  flex: 1,
                  fontSize: 14,
                  opacity: isJoining ? 0.6 : 1,
                  cursor: isJoining ? 'wait' : 'pointer',
                }}
              >
                {isJoining ? 'Joining...' : 'Join Crew'}
              </button>
            )
          )}
        </div>

        {/* Tasks Section */}
        {crew.tasks && crew.tasks.length > 0 && (
          <div style={{ marginTop: 16, borderTop: '1px solid hsl(var(--rule) / 0.10)', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Top Tasks
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {crew.tasks.map((task, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {task.priority && (
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: task.priority === 'Top' ? 'hsl(var(--tomato) / 0.15)' :
                                 task.priority === 'High' ? 'rgba(255,167,38,0.15)' :
                                 task.priority === 'Mid' ? 'rgba(33,150,243,0.15)' : 'hsl(var(--ink) / 0.06)',
                      color: task.priority === 'Top' ? 'hsl(var(--tomato))' :
                            task.priority === 'High' ? '#ef6c00' :
                            task.priority === 'Mid' ? '#1565c0' : 'hsl(var(--muted-foreground))',
                      flexShrink: 0,
                    }}>
                      {task.priority}
                    </span>
                  )}
                  {task.url ? (
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 14, color: 'hsl(var(--tomato))', textDecoration: 'none', lineHeight: 1.4, minHeight: 44, display: 'flex', alignItems: 'center' }}
                    >
                      {task.label}
                    </a>
                  ) : (
                    <span style={{ fontSize: 14, color: 'hsl(var(--foreground))', lineHeight: 1.4 }}>{task.label}</span>
                  )}
                </div>
              ))}
            </div>
            {(crew.taskCount ?? 0) > 3 && (
              <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 8 }}>
                +{(crew.taskCount ?? 0) - 3} more tasks
              </div>
            )}
          </div>
        )}

        {crew.sheet && (
          <a
            href={crew.sheet}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginTop: 10,
              fontSize: 14,
              opacity: 0.6,
              textDecoration: 'none',
              minHeight: 44,
            }}
          >
            Open sheet ↗
          </a>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'hsl(var(--background))',
        fontFamily: inter.style.fontFamily,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={loadingSpinner()} />
          <p style={{ fontSize: 18, opacity: 0.8 }}>Loading crews...</p>
          <style jsx>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'hsl(var(--background))',
        color: 'hsl(var(--foreground))',
        fontFamily: inter.style.fontFamily,
        padding: 20,
      }}>
        <div style={card()}>
          <h1
            style={{
              fontSize: 24,
              marginBottom: 16,
              textWrap: 'balance',
            } as React.CSSProperties}
          >
            Error
          </h1>
          <p style={{ opacity: 0.7, marginBottom: 32 }}>{error}</p>
          <Link href="/" style={btn('primary')}>Back to Home</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={pageContainer(inter.style.fontFamily)}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gap: 24 }}>
        {/* Navigation */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/" style={{ ...navBtn(), padding: '10px 16px', minHeight: 44 }}>
            ← Home
          </Link>
          {user && (
            <Link href={`/dashboard/${user.memberId}`} style={{ ...navBtn(), padding: '10px 16px', minHeight: 44 }}>
              My Dashboard
            </Link>
          )}
          <Link href="/crew" style={{ ...navBtn(), padding: '10px 16px', minHeight: 44 }}>
            Browse Members
          </Link>
          <Link
            href="/manuals"
            style={{
              ...navBtn(),
              padding: '10px 16px',
              minHeight: 44,
              background: 'hsl(var(--butter))',
              borderColor: 'hsl(var(--butter))',
              color: 'hsl(var(--ink))',
            }}
          >
            Browse All Manuals
          </Link>
        </div>

        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 20 }}>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              margin: 0,
              textWrap: 'balance',
            } as React.CSSProperties}
          >
            All Crews
          </h1>
          <p style={{ fontSize: 16, opacity: 0.6, marginTop: 8 }}>
            {user ? `Welcome, ${user.name}! Join crews to get involved.` : 'Log in to join crews'}
          </p>
        </header>

        {/* Crews by Day of Week */}
        {isMobile ? (
          /* Mobile: stacked day sections */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {scheduledCrews.map(({ day, crews: dayCrews }) => (
              <div key={day}>
                <h3 style={{
                  fontSize: 16,
                  fontWeight: 700,
                  marginBottom: 12,
                  color: 'hsl(var(--foreground))',
                  borderBottom: '2px solid hsl(var(--rule) / 0.10)',
                  paddingBottom: 8,
                }}>
                  {day}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {dayCrews.map(crew => renderCrewCard(crew as CrewOption))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Desktop: side-by-side day columns */
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            {scheduledCrews.map(({ day, crews: dayCrews }) => (
              <div key={day} style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{
                  fontSize: 16,
                  fontWeight: 700,
                  marginBottom: 12,
                  color: 'hsl(var(--foreground))',
                  borderBottom: '2px solid hsl(var(--rule) / 0.10)',
                  paddingBottom: 8,
                  textAlign: 'center',
                }}>
                  {day}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {dayCrews.map(crew => renderCrewCard(crew as CrewOption))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Other Crews Section */}
        {otherCrews.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h2
              style={{
                fontSize: 24,
                fontWeight: 700,
                marginBottom: 16,
                color: 'hsl(var(--foreground))',
                borderBottom: '2px solid hsl(var(--rule) / 0.10)',
                paddingBottom: 10,
                textWrap: 'balance',
              } as React.CSSProperties}
            >
              Other Crews
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
              gap: 16,
            }}>
              {otherCrews.map(crew => renderCrewCard(crew as CrewOption))}
            </div>
          </div>
        )}

        {/* Not logged in message */}
        {!user && (
          <div style={{
            ...card(),
            textAlign: 'center',
            marginTop: 20,
          }}>
            <p style={{ fontSize: 16, marginBottom: 16 }}>
              Log in with Discord to join crews
            </p>
            <Link href="/" style={btn('primary')}>
              Go to Home
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
