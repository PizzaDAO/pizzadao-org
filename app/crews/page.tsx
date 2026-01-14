'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

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

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
        fontFamily: inter.style.fontFamily,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 50,
            height: 50,
            border: '4px solid rgba(0,0,0,0.1)',
            borderTop: '4px solid #ff4d4d',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px',
          }} />
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
        background: '#fafafa',
        fontFamily: inter.style.fontFamily,
        padding: 20,
      }}>
        <div style={card()}>
          <h1 style={{ fontSize: 24, marginBottom: 16 }}>Error</h1>
          <p style={{ opacity: 0.7, marginBottom: 32 }}>{error}</p>
          <Link href="/" style={btn('primary')}>Back to Home</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#fafafa',
      color: '#000',
      fontFamily: inter.style.fontFamily,
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 24 }}>
        {/* Navigation */}
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href="/" style={{
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
          }}>
            ← Home
          </Link>
          {user && (
            <Link href={`/dashboard/${user.memberId}`} style={{
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
            }}>
              My Dashboard
            </Link>
          )}
        </div>

        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>All Crews</h1>
          <p style={{ fontSize: 16, opacity: 0.6, marginTop: 8 }}>
            {user ? `Welcome, ${user.name}! Join crews to get involved.` : 'Log in to join crews'}
          </p>
        </header>

        {/* Crews Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {crews.map((crew) => {
            const inCrew = isInCrew(crew.id)
            const isJoining = joining === crew.id
            const isLeaving = leaving === crew.id

            return (
              <div key={crew.id} style={{
                ...card(),
                border: inCrew ? '2px solid #4caf50' : '1px solid rgba(0,0,0,0.12)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
                      {crew.emoji && `${crew.emoji} `}{crew.label}
                    </h2>
                    {(crew.callTime || crew.callLength) && (
                      <p style={{ fontSize: 13, opacity: 0.7, margin: '8px 0 0' }}>
                        {crew.callTime && (
                          crew.callTimeUrl ? (
                            <a href={crew.callTimeUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                              {crew.callTime}
                            </a>
                          ) : crew.callTime
                        )}
                        {crew.callTime && crew.callLength && ' • '}
                        {crew.callLength}
                      </p>
                    )}
                  </div>
                  {inCrew && (
                    <span style={{
                      background: '#e8f5e9',
                      color: '#2e7d32',
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
                          color: '#d32f2f',
                          borderColor: '#d32f2f',
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

                {crew.sheet && (
                  <a
                    href={crew.sheet}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'block',
                      marginTop: 10,
                      fontSize: 13,
                      opacity: 0.6,
                      textDecoration: 'none',
                    }}
                  >
                    Open sheet ↗
                  </a>
                )}
              </div>
            )
          })}
        </div>

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

function btn(kind: 'primary' | 'secondary'): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '10px 16px',
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.18)',
    fontWeight: 650,
    cursor: 'pointer',
    textDecoration: 'none',
    textAlign: 'center',
    fontFamily: 'inherit',
  }
  if (kind === 'primary') return { ...base, background: 'black', color: 'white', borderColor: 'black' }
  return { ...base, background: 'white', color: 'black' }
}
