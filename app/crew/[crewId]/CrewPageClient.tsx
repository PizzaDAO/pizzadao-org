'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { TURTLES } from '@/app/ui/constants'
import {
  badge,
  btn,
  card,
  loadingSpinner,
  navBtn,
  pageContainer,
} from '@/app/ui/shared-styles'

// Loading stages to show progress
const LOADING_STAGES = [
  'Connecting to server...',
  'Loading crew info...',
  'Fetching roster...',
  'Loading tasks...',
  'Almost ready...',
]

const DISPLAY_FONT =
  'var(--font-display), var(--font-sans), system-ui, sans-serif'

type CrewData = {
  crew: {
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
  roster: Array<{
    id: string
    status: string
    name: string
    city: string
    org: string
    skills: string
    turtles: string
    telegram: string
    attendance: string
    notes: string
  }>
  goals: Array<{
    priority: string
    description: string
  }>
  tasks: Array<{
    priority: string
    stage: string
    goal?: string
    task: string
    dueDate?: string
    lead?: string
    leadId?: string
    notes?: string
    url?: string
  }>
  agenda: Array<{
    time: string
    lead: string
    step: string
    stepUrl?: string
    action: string
    notes: string
  }>
  callInfo: {
    time: string
    song: string
    announcements: string
  } | null
}

type UserData = {
  memberId: string
  name: string
  crews: string[]
  discordId?: string
}

type Manual = {
  title: string
  url: string | null
  crew: string
  status: string
  authorId: string
  author: string
  lastUpdated: string
  notes: string
}

export default function CrewPageClient({ params }: { params: Promise<{ crewId: string }> }) {
  const { crewId } = use(params)
  const [data, setData] = useState<CrewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingStage, setLoadingStage] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [user, setUser] = useState<UserData | null>(null)
  const [userFetched, setUserFetched] = useState(false)
  const [joining, setJoining] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [manuals, setManuals] = useState<Manual[]>([])
  const [shareCopied, setShareCopied] = useState(false)

  // Collapsed section state
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    bench: true, // Bench collapsed by default
    other: false,
    agenda: false,
    roster: false,
    goals: false,
    myTasks: false, // My Tasks expanded by default
    topTasks: false, // Top Tasks expanded by default
    otherTasks: true, // Other Tasks collapsed by default
    manuals: false,
    // Goal sections (goal_0, goal_1, etc.) default to collapsed (handled via ?? true)
  })
  const [showLaterTasks, setShowLaterTasks] = useState(false)
  const [showOpenOnly, setShowOpenOnly] = useState(false)
  const [claimingTask, setClaimingTask] = useState<string | null>(null)

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => {
      // Goal sections (goal_0, goal_1, etc.) default to collapsed (true)
      const currentValue = prev[section] ?? (section.startsWith('goal_') ? true : false)
      return { ...prev, [section]: !currentValue }
    })
  }

  // Fetch crew data
  useEffect(() => {
    async function fetchCrew() {
      try {
        const res = await fetch(`/api/crew/${crewId}`)
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to load crew')
        }
        const json = await res.json()
        setData(json)
      } catch (e: unknown) {
        setError((e as any)?.message)
      } finally {
        setLoading(false)
      }
    }
    fetchCrew()
  }, [crewId])

  // Fetch user data
  useEffect(() => {
    async function fetchUser() {
      try {
        const meRes = await fetch('/api/me')
        if (!meRes.ok) return

        const meData = await meRes.json()
        if (!meData.authenticated || !meData.discordId) return

        // Look up memberId from discordId
        const lookupRes = await fetch(`/api/member-lookup/${meData.discordId}`)
        if (!lookupRes.ok) return

        const lookupData = await lookupRes.json()
        if (!lookupData.memberId) return

        const profileRes = await fetch(`/api/profile/${lookupData.memberId}`)
        if (profileRes.ok) {
          const profileData = await profileRes.json()
          const userCrews = profileData.Crews
            ? profileData.Crews.split(',').map((c: string) => c.trim().toLowerCase()).filter(Boolean)
            : []
          setUser({
            memberId: lookupData.memberId,
            name: lookupData.memberName || profileData.Name,
            crews: userCrews,
            discordId: meData.discordId,
          })
        }
      } catch (e) {
      } finally {
        setUserFetched(true)
      }
    }
    fetchUser()
  }, [])

  // Fetch manuals for this crew
  useEffect(() => {
    async function fetchManuals() {
      try {
        const res = await fetch(`/api/manuals?crew=${encodeURIComponent(crewId)}`)
        if (res.ok) {
          const data = await res.json()
          setManuals(data.manuals || [])
        }
      } catch (e) {
      }
    }
    fetchManuals()
  }, [crewId])

  const isInCrew = user?.crews.some(c => c.toLowerCase() === crewId.toLowerCase()) ?? false

  const handleJoinCrew = async () => {
    if (!user) {
      alert('Please log in to join this crew')
      return
    }
    setJoining(true)
    try {
      const res = await fetch('/api/join-crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crewId, action: 'join' }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to join crew')
      setUser(prev => prev ? { ...prev, crews: [...prev.crews, crewId.toLowerCase()] } : null)
    } catch (e: unknown) {
      alert((e as any)?.message)
    } finally {
      setJoining(false)
    }
  }

  const handleLeaveCrew = async () => {
    if (!user) return
    setLeaving(true)
    try {
      const res = await fetch('/api/join-crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crewId, action: 'leave' }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to leave crew')
      setUser(prev => prev ? { ...prev, crews: prev.crews.filter(c => c.toLowerCase() !== crewId.toLowerCase()) } : null)
    } catch (e: unknown) {
      alert((e as any)?.message)
    } finally {
      setLeaving(false)
    }
  }

  const handleShare = async () => {
    try {
      const url = typeof window !== 'undefined' ? window.location.href : ''
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 2000)
      }
    } catch {
      // Clipboard write failed — silently ignore (Safari private mode, etc.)
    }
  }

  const handleClaimTask = async (taskName: string) => {
    if (!user) {
      alert('Please log in to claim this task')
      return
    }
    if (!data?.crew.sheet) {
      alert('No sheet configured for this crew')
      return
    }
    setClaimingTask(taskName)
    try {
      const res = await fetch('/api/claim-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetUrl: data.crew.sheet,
          taskName,
          memberId: user.memberId,
          action: 'claim',
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to claim task')
      // Update local state to reflect the claim
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          tasks: prev.tasks.map(t =>
            t.task === taskName ? { ...t, lead: user.name, leadId: user.memberId } : t
          ),
        }
      })
    } catch (e: unknown) {
      alert((e as any)?.message)
    } finally {
      setClaimingTask(null)
    }
  }

  const handleGiveUpTask = async (taskName: string) => {
    if (!user) return
    if (!data?.crew.sheet) {
      alert('No sheet configured for this crew')
      return
    }
    setClaimingTask(taskName)
    try {
      const res = await fetch('/api/claim-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetUrl: data.crew.sheet,
          taskName,
          action: 'giveup',
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to give up task')
      // Update local state to reflect giving up
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          tasks: prev.tasks.map(t =>
            t.task === taskName ? { ...t, lead: '', leadId: '' } : t
          ),
        }
      })
    } catch (e: unknown) {
      alert((e as any)?.message)
    } finally {
      setClaimingTask(null)
    }
  }

  // Animate loading stages and track elapsed time
  useEffect(() => {
    if (!loading) return

    const startTime = Date.now()

    // Update elapsed time every 100ms
    const timerInterval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 100) / 10)
    }, 100)

    // Cycle through loading stages
    const stageInterval = setInterval(() => {
      setLoadingStage(prev => (prev + 1) % LOADING_STAGES.length)
    }, 1200)

    return () => {
      clearInterval(timerInterval)
      clearInterval(stageInterval)
    }
  }, [loading])

  if (loading) {
    return (
      <div style={{
        ...pageContainer(),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={loadingSpinner()} />
          <p style={{
            fontSize: 18,
            color: 'hsl(var(--foreground))',
            marginBottom: 8,
            fontFamily: DISPLAY_FONT,
          }}>
            {LOADING_STAGES[loadingStage]}
          </p>
          <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>
            {elapsedTime.toFixed(1)}s
          </p>
          <style jsx>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{
        ...pageContainer(),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}>
        <div style={card()}>
          <h1 style={{
            fontSize: 28,
            margin: 0,
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            letterSpacing: '-0.01em',
          }}>Crew Not Found</h1>
          <p style={{ color: 'hsl(var(--muted-foreground))', margin: 0 }}>
            {error || 'Could not load crew data'}
          </p>
          <Link href="/" style={btn('primary')}>Back to Home</Link>
        </div>
      </div>
    )
  }

  const { crew, roster, goals, tasks, agenda, callInfo } = data

  // Visitor view: shown when the viewer is not (yet) a member of this crew,
  // including signed-out viewers. Members keep the full coordination view.
  const isVisitor = userFetched && !isInCrew

  if (isVisitor) {
    // Visible roster, hiding "iced" members
    const visibleRoster = roster.filter((m) => !m.status?.toLowerCase().includes('iced'))

    // Recent activity: most recent task completions (best-effort from sheet data)
    const isDone = (s: string) => {
      const l = s?.toLowerCase() || ''
      return l === 'done' || l === 'complete' || l === 'completed'
    }
    const recentTaskCloses = tasks
      .filter((t) => isDone(t.stage))
      .slice(0, 5)

    return (
      <div style={pageContainer()}>
        <div className="fade-up" style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 24 }}>
          {/* Navigation */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/" style={navBtn()}>← Home</Link>
            <Link href="/crews" style={navBtn()}>All Crews</Link>
            <Link href="/crew" style={navBtn()}>All Members</Link>
            {user && (
              <Link href={`/dashboard/${user.memberId}`} style={navBtn()}>
                My Dashboard
              </Link>
            )}
          </div>

          {/* onion-15370: editorial visitor hero — overline + display crew name + emoji */}
          <header style={{ textAlign: 'center', marginBottom: 8, position: 'relative' }}>
            <p
              className="overline"
              style={{ color: 'hsl(var(--tomato))', marginBottom: 14 }}
            >
              § ··· The Crew
            </p>
            <div style={{ fontSize: 'clamp(2.5rem, 12vw, 56px)', marginBottom: 8, lineHeight: 1 }}>
              {crew.emoji || '🍕'}
            </div>
            <h1
              style={{
                // quattro-formaggi-54080: clamp so the title scales from
                // 32px on 375px viewports up to 56px on desktop.
                fontSize: 'clamp(2rem, 8vw, 3.5rem)',
                lineHeight: 1.02,
                fontWeight: 800,
                margin: 0,
                letterSpacing: '-0.015em',
                fontFamily: DISPLAY_FONT,
                color: 'hsl(var(--foreground))',
                overflowWrap: 'anywhere',
              }}
            >
              {crew.label}
            </h1>
            <p
              style={{
                marginTop: 12,
                maxWidth: 640,
                marginLeft: 'auto',
                marginRight: 'auto',
                fontSize: 17,
                lineHeight: 1.5,
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              {visitorMissionLine(crew.id, crew.label)}
            </p>
            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'center',
                marginTop: 18,
                flexWrap: 'wrap',
              }}
            >
              {crew.callTime &&
                (crew.callTimeUrl ? (
                  <a
                    href={crew.callTimeUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...badge(), textDecoration: 'none' }}
                  >
                    🕐 {crew.callTime}
                  </a>
                ) : (
                  <span style={badge()}>🕐 {crew.callTime}</span>
                ))}
              {crew.callLength && <span style={badge()}>⏱ {crew.callLength}</span>}
              {crew.channel && <span style={badge()}>💬 #{crew.channel}</span>}
            </div>

            {/* Visitor CTAs: Join + Share — onion-15370 editorial pill CTAs */}
            <div
              style={{
                marginTop: 22,
                display: 'flex',
                gap: 10,
                justifyContent: 'center',
                flexWrap: 'wrap',
                alignItems: 'center',
                position: 'relative',
              }}
            >
              {/* handwritten margin annotation near the Join CTA */}
              <span
                aria-hidden
                className="handwritten onion-join-margin"
                style={{
                  position: 'absolute',
                  left: '50%',
                  transform: 'translate(-145px, -28px) rotate(-8deg)',
                  fontSize: 18,
                  color: 'hsl(var(--tomato))',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                join us →
              </span>
              {user ? (
                <button
                  onClick={handleJoinCrew}
                  disabled={joining}
                  className="btn-pill-lg"
                  style={{
                    background: 'hsl(var(--tomato))',
                    color: 'hsl(var(--cream))',
                    border: '1px solid hsl(var(--tomato))',
                    boxShadow: 'var(--shadow-soft)',
                    minHeight: 44,
                  }}
                >
                  {joining ? 'Joining...' : 'Join This Crew'}
                </button>
              ) : (
                <Link
                  href="/"
                  className="btn-pill-lg"
                  style={{
                    background: 'hsl(var(--tomato))',
                    color: 'hsl(var(--cream))',
                    border: '1px solid hsl(var(--tomato))',
                    textDecoration: 'none',
                    boxShadow: 'var(--shadow-soft)',
                    minHeight: 44,
                  }}
                >
                  Log in to join
                </Link>
              )}
              <button
                onClick={handleShare}
                className="btn-pill"
                style={{
                  background: 'hsl(var(--secondary))',
                  color: 'hsl(var(--secondary-foreground))',
                  border: '1px solid hsl(var(--rule-warm) / 0.55)',
                  cursor: 'pointer',
                  minHeight: 44,
                }}
                aria-label="Copy link to this crew page"
              >
                {shareCopied ? '✓ Link copied' : '🔗 Share'}
              </button>
              <style>{`
                .onion-join-margin { display: none; }
                @media (min-width: 640px) {
                  .onion-join-margin { display: inline-block; }
                }
              `}</style>
            </div>
          </header>

          {/* Member roster (visitor-facing: editorial paper-soft gallery) */}
          {visibleRoster.length > 0 && (
            <div style={card()}>
              <h2 style={sectionTitle()}>Members ({visibleRoster.length})</h2>
              <div
                style={{
                  display: 'grid',
                  // quattro-formaggi-54080: min(220px, 100%) so 375px
                  // viewports collapse to one column without overflow.
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
                  gap: 14,
                }}
              >
                {visibleRoster.map((member, i) => (
                  <Link
                    key={member.id || i}
                    href={`/profile/${member.id}`}
                    className="paper-soft"
                    style={{
                      ...memberCard(),
                      display: 'block',
                      textDecoration: 'none',
                      color: 'hsl(var(--foreground))',
                      minHeight: 44,
                      // onion-15370: subtle alternating rotation for gallery feel
                      transform: `rotate(${(i % 3 === 0 ? -0.6 : i % 3 === 1 ? 0.5 : -0.2).toFixed(2)}deg)`,
                      borderColor: 'hsl(var(--rule-warm) / 0.55)',
                      boxShadow: 'var(--shadow-soft)',
                      transition: 'transform 240ms var(--ease-editorial), box-shadow 240ms var(--ease-editorial), border-color 240ms var(--ease-editorial)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'rotate(0deg) translateY(-3px)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-lifted)';
                      e.currentTarget.style.borderColor = 'hsl(var(--tomato) / 0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = `rotate(${(i % 3 === 0 ? -0.6 : i % 3 === 1 ? 0.5 : -0.2).toFixed(2)}deg)`;
                      e.currentTarget.style.boxShadow = 'var(--shadow-soft)';
                      e.currentTarget.style.borderColor = 'hsl(var(--rule-warm) / 0.55)';
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 16,
                        fontFamily: DISPLAY_FONT,
                        letterSpacing: '-0.005em',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {member.name}
                    </div>
                    {member.city && (
                      <div
                        style={{
                          fontSize: 13,
                          color: 'hsl(var(--muted-foreground))',
                          marginTop: 2,
                        }}
                      >
                        {member.city}
                      </div>
                    )}
                    {member.turtles && (
                      <div
                        style={{
                          marginTop: 8,
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 4,
                        }}
                      >
                        {member.turtles.split(',').map((tName, j) => {
                          const tDef = TURTLES.find(
                            (t) =>
                              t.id.toLowerCase() === tName.trim().toLowerCase() ||
                              t.label.toLowerCase() === tName.trim().toLowerCase()
                          )
                          if (!tDef) return null
                          return (
                            <img
                              key={j}
                              src={tDef.image}
                              alt={tDef.label}
                              title={tDef.label}
                              style={{ width: 24, height: 24, objectFit: 'contain' }}
                            />
                          )
                        })}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {recentTaskCloses.length > 0 && (
            <div style={card()}>
              <h2 style={sectionTitle()}>Recent activity</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                {recentTaskCloses.map((t, i) => (
                  <li
                    key={i}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--rule) / 0.10)',
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      // quattro-formaggi-54080: let long task / lead names
                      // wrap to a second line on <sm rather than overflow.
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 14 }}>✅</span>
                    <span style={{ fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0, flex: '1 1 auto' }}>{t.task}</span>
                    {t.lead && t.lead !== '#N/A' && (
                      <span
                        style={{
                          fontSize: 12,
                          color: 'hsl(var(--muted-foreground))',
                          marginLeft: 'auto',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        by {t.leadId ? (
                          <Link href={`/profile/${t.leadId}`} style={tomatoLink()}>
                            {t.lead}
                          </Link>
                        ) : (
                          t.lead
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer CTA — repeated join button for long pages (onion-15370 editorial) */}
          <div
            className="paper-soft"
            style={{
              textAlign: 'center',
              marginTop: 8,
              // quattro-formaggi-54080: clamp padding so the CTA card
              // doesn't crowd a 375px viewport.
              padding: 'clamp(16px, 5vw, 28px)',
              borderRadius: 'var(--radius)',
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--rule-warm) / 0.55)',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            <p className="overline" style={{ color: 'hsl(var(--tomato))', marginBottom: 10 }}>
              § ··· An invitation
            </p>
            <h3
              style={{
                margin: 0,
                marginBottom: 8,
                fontFamily: DISPLAY_FONT,
                fontSize: 'clamp(1.4rem, 4vw, 1.75rem)',
                fontWeight: 800,
                letterSpacing: '-0.015em',
              }}
            >
              Like what you see?
            </h3>
            <p
              style={{
                margin: 0,
                marginBottom: 18,
                color: 'hsl(var(--muted-foreground))',
              }}
            >
              Join {crew.label} and start helping out.
            </p>
            {user ? (
              <button
                onClick={handleJoinCrew}
                disabled={joining}
                className="btn-pill-lg"
                style={{
                  background: 'hsl(var(--tomato))',
                  color: 'hsl(var(--cream))',
                  border: '1px solid hsl(var(--tomato))',
                  opacity: joining ? 0.5 : 1,
                  minHeight: 44,
                }}
              >
                {joining ? 'Joining...' : 'Join This Crew'}
              </button>
            ) : (
              <Link
                href="/"
                className="btn-pill-lg"
                style={{
                  background: 'hsl(var(--tomato))',
                  color: 'hsl(var(--cream))',
                  border: '1px solid hsl(var(--tomato))',
                  textDecoration: 'none',
                  minHeight: 44,
                }}
              >
                Log in to join
              </Link>
            )}
          </div>

          {/* Back link */}
          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <Link href="/crews" style={btn('secondary')}>← Back to all crews</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={pageContainer()}>
      <div className="fade-up" style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 24 }}>
        {/* Navigation */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/" style={navBtn()}>← Home</Link>
          <Link href="/crews" style={navBtn()}>All Crews</Link>
          <Link href="/crew" style={navBtn()}>← All Members</Link>
          {crewId.toLowerCase() === 'tech' && (
            <Link href="/tech/projects" style={navBtn()}>Projects</Link>
          )}
          {crewId.toLowerCase() === 'comms' && (
            <>
              <Link href="/articles" style={navBtn()}>Articles</Link>
              <a
                href="https://pizzadao.xyz/brand"
                target="_blank"
                rel="noreferrer"
                style={navBtn()}
              >
                Brand Kit
              </a>
            </>
          )}
          {user && (
            <Link href={`/dashboard/${user.memberId}`} style={navBtn()}>
              My Dashboard
            </Link>
          )}
        </div>

        {/* onion-15370: editorial member-view header — dossier overline + display name */}
        <header style={{ textAlign: 'center', marginBottom: 8 }}>
          <p className="overline" style={{ color: 'hsl(var(--tomato))', marginBottom: 14 }}>
            § ··· Your crew
          </p>
          <div style={{ fontSize: 'clamp(2.5rem, 12vw, 56px)', marginBottom: 8, lineHeight: 1 }}>{crew.emoji || '🍕'}</div>
          <h1 style={{
            // quattro-formaggi-54080: clamp so the title scales from 32px
            // on 375px viewports up to 56px on desktop.
            fontSize: 'clamp(2rem, 8vw, 3.5rem)',
            lineHeight: 1.02,
            fontWeight: 800,
            margin: 0,
            letterSpacing: '-0.015em',
            fontFamily: DISPLAY_FONT,
            color: 'hsl(var(--foreground))',
            overflowWrap: 'anywhere',
          }}>
            {crew.label}
          </h1>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            {crew.callTime && (
              crew.callTimeUrl ? (
                <a
                  href={crew.callTimeUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...badge(), textDecoration: 'none' }}
                >
                  🕐 {crew.callTime}
                </a>
              ) : (
                <span style={badge()}>🕐 {crew.callTime}</span>
              )
            )}
            {crew.callLength && (
              <span style={badge()}>⏱ {crew.callLength}</span>
            )}
            {crew.sheet && (
              <a
                href={crew.sheet}
                target="_blank"
                rel="noreferrer"
                style={{ ...badge(), textDecoration: 'none' }}
              >
                📊 Open Sheet
              </a>
            )}
          </div>

          {/* Join/Leave Crew Button — onion-15370 editorial pill styling */}
          <div style={{ marginTop: 20 }}>
            {user ? (
              isInCrew ? (
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{
                    background: 'hsl(142 71% 35% / 0.10)',
                    color: 'hsl(142 71% 30%)',
                    padding: '8px 16px',
                    borderRadius: 999,
                    fontSize: 14,
                    fontWeight: 600,
                    border: '1px solid hsl(142 71% 35% / 0.25)',
                  }}>
                    You&apos;re a member of this crew
                  </span>
                  <button
                    onClick={handleLeaveCrew}
                    disabled={leaving}
                    className="btn-pill"
                    style={{
                      background: 'transparent',
                      borderColor: 'hsl(var(--tomato) / 0.35)',
                      border: '1px solid hsl(var(--tomato) / 0.35)',
                      color: 'hsl(var(--tomato))',
                      minHeight: 44,
                      opacity: leaving ? 0.5 : 1,
                      cursor: leaving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {leaving ? 'Leaving...' : 'Leave Crew'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleJoinCrew}
                  disabled={joining}
                  className="btn-pill-lg"
                  style={{
                    background: 'hsl(var(--tomato))',
                    color: 'hsl(var(--cream))',
                    border: '1px solid hsl(var(--tomato))',
                    minHeight: 44,
                    boxShadow: 'var(--shadow-soft)',
                    opacity: joining ? 0.5 : 1,
                    cursor: joining ? 'not-allowed' : 'pointer',
                  }}
                >
                  {joining ? 'Joining...' : 'Join This Crew'}
                </button>
              )
            ) : (
              <p style={{ fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>
                <Link
                  href="/"
                  style={{
                    color: 'hsl(var(--tomato))',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  Log in
                </Link>
                {' '}to join this crew
              </p>
            )}
          </div>
        </header>

        {/* Agenda — onion-15370: dossier-style overline above heading */}
        {agenda.length > 0 && (
          <div style={card()}>
            <p className="overline" style={{ color: 'hsl(var(--tomato))', margin: 0, marginBottom: 6 }}>
              § ··· Dossier · meeting
            </p>
            <h2
              onClick={() => toggleSection('agenda')}
              style={{ ...sectionTitle(), cursor: 'pointer', userSelect: 'none', minHeight: 44, display: 'flex', alignItems: 'center' }}
            >
              {collapsedSections.agenda ? '▶' : '▼'} Meeting Agenda ({agenda.length})
            </h2>
            {!collapsedSections.agenda && (
              // quattro-formaggi-54080: 4-column table needs horizontal
              // scroll on <sm viewports rather than overflowing the card.
              <div style={{ overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th style={th()}>Time</th>
                      <th style={th()}>Lead</th>
                      <th style={th()}>Step</th>
                      <th style={th()}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agenda.map((item, i) => (
                      <tr key={i}>
                        <td style={td()}>{item.time}</td>
                        <td style={td()}>{item.lead}</td>
                        <td style={td()}>
                          {item.stepUrl ? (
                            <a
                              href={item.stepUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={inlineLink()}
                            >
                              {item.step}
                            </a>
                          ) : (
                            item.step
                          )}
                        </td>
                        <td style={td()}>{item.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Crew Roster */}
        {(() => {
          // Filter out "6. Iced" members
          const visibleRoster = roster.filter(m => !m.status?.toLowerCase().includes('iced'))

          // Split into Active and Bench
          const activeStatuses = ['0. lead', '1. capo', '2. hot', '3. warm']
          const benchStatuses = ['4. cool', '5. cold']

          const isActive = (status: string) => activeStatuses.some(s => status?.toLowerCase().includes(s.split('. ')[1]))
          const isBench = (status: string) => benchStatuses.some(s => status?.toLowerCase().includes(s.split('. ')[1]))

          const activeMembers = visibleRoster.filter(m => isActive(m.status))
          const benchMembers = visibleRoster.filter(m => isBench(m.status))
          const otherMembers = visibleRoster.filter(m => !isActive(m.status) && !isBench(m.status))

          const renderMemberCard = (member: typeof roster[0], i: number) => (
            // onion-15370: paper-soft tactile noise for editorial dossier feel
            <div
              key={i}
              className="paper-soft"
              style={{
                ...memberCard(),
                borderColor: 'hsl(var(--rule-warm) / 0.55)',
                boxShadow: 'var(--shadow-soft)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 60%' }}>
                  <Link
                    href={`/profile/${member.id}`}
                    style={{
                      fontWeight: 700,
                      fontSize: 17,
                      color: 'hsl(var(--foreground))',
                      textDecoration: 'none',
                      fontFamily: DISPLAY_FONT,
                      letterSpacing: '-0.005em',
                      transition: 'color 150ms ease',
                      // quattro-formaggi-54080: long pizza names (e.g.
                      // "Bartholomew the Bell-Pepper Bandito") wrap rather
                      // than overflow the card on phones.
                      display: 'inline-block',
                      overflowWrap: 'anywhere',
                      minHeight: 44,
                      lineHeight: 1.3,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'hsl(var(--tomato))')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'hsl(var(--foreground))')}
                  >
                    {member.name}
                  </Link>
                  {member.city && (
                    <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', marginTop: 2 }}>
                      {member.city}
                    </div>
                  )}
                </div>
                {member.status && (
                  <span style={statusBadge(member.status)}>{member.status}</span>
                )}
              </div>
              {member.turtles && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {member.turtles.split(',').map((tName, j) => {
                    const tDef = TURTLES.find(t =>
                      t.id.toLowerCase() === tName.trim().toLowerCase() ||
                      t.label.toLowerCase() === tName.trim().toLowerCase()
                    )
                    if (!tDef) return null
                    return (
                      <img
                        key={j}
                        src={tDef.image}
                        alt={tDef.label}
                        title={tDef.label}
                        style={{ width: 28, height: 28, objectFit: 'contain' }}
                      />
                    )
                  })}
                </div>
              )}
              {member.skills && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>
                  <strong style={{ color: 'hsl(var(--foreground))' }}>Skills:</strong> {member.skills}
                </div>
              )}
              {member.org && (
                <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                  <strong style={{ color: 'hsl(var(--foreground))' }}>Orgs:</strong> {member.org}
                </div>
              )}
            </div>
          )

          if (visibleRoster.length === 0) return null

          return (
            <div style={card()}>
              <h2
                onClick={() => toggleSection('roster')}
                style={{ ...sectionTitle(), cursor: 'pointer', userSelect: 'none', minHeight: 44, display: 'flex', alignItems: 'center' }}
              >
                {collapsedSections.roster ? '▶' : '▼'} Crew Roster ({visibleRoster.length} members)
              </h2>

              {!collapsedSections.roster && activeMembers.length > 0 && (
                <>
                  <h3 style={subSectionTitle('hsl(142 71% 30%)')}>
                    Active ({activeMembers.length})
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12, marginBottom: 24 }}>
                    {activeMembers.map(renderMemberCard)}
                  </div>
                </>
              )}

              {!collapsedSections.roster && benchMembers.length > 0 && (
                <>
                  <h3
                    onClick={() => toggleSection('bench')}
                    style={collapsibleHeader('hsl(var(--ink-soft))')}
                  >
                    <span>{collapsedSections.bench ? '▶' : '▼'} Bench ({benchMembers.length})</span>
                  </h3>
                  {!collapsedSections.bench && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12, marginBottom: 24 }}>
                      {benchMembers.map(renderMemberCard)}
                    </div>
                  )}
                </>
              )}

              {!collapsedSections.roster && otherMembers.length > 0 && (
                <>
                  <h3
                    onClick={() => toggleSection('other')}
                    style={collapsibleHeader('hsl(var(--muted-foreground))')}
                  >
                    <span>{collapsedSections.other ? '▶' : '▼'} Other ({otherMembers.length})</span>
                  </h3>
                  {!collapsedSections.other && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 }}>
                      {otherMembers.map(renderMemberCard)}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })()}

        {/* Goals */}
        {goals.length > 0 && (
          <div style={card()}>
            <h2
              onClick={() => toggleSection('goals')}
              style={{ ...sectionTitle(), cursor: 'pointer', userSelect: 'none', minHeight: 44, display: 'flex', alignItems: 'center' }}
            >
              {collapsedSections.goals ? '▶' : '▼'} Goals ({goals.length})
            </h2>
            {!collapsedSections.goals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 }}>
                {goals.map((goal, i) => (
                  <div key={i} style={itemCard(goal.priority)}>
                    {goal.priority && (
                      <span style={priorityBadge(goal.priority)}>{goal.priority}</span>
                    )}
                    <div style={{ fontWeight: 500, marginTop: goal.priority ? 8 : 0 }}>{goal.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tasks */}
        {tasks.length > 0 && (() => {
          const isTopPriority = (p: string) => {
            const lower = p?.toLowerCase() || ''
            return lower.includes('0.') || lower.includes('top')
          }
          const isLater = (t: typeof tasks[0]) => t.stage?.toLowerCase().includes('later')
          const isMyTask = (t: typeof tasks[0]) => user && t.leadId === user.memberId

          // My tasks (user is the lead) - shown at top
          const myTasks = tasks.filter(t => isMyTask(t))

          // Top priority tasks (excluding my tasks and later tasks)
          const topTasks = tasks.filter(t => isTopPriority(t.priority) && !isMyTask(t) && !isLater(t))

          // Group remaining tasks by goal (excluding my tasks, top tasks, and later tasks)
          const tasksByGoal = new Map<string, typeof tasks>()
          const ungroupedTasks: typeof tasks = []
          const laterTasks: typeof tasks = []

          tasks.filter(t => !isMyTask(t) && !isTopPriority(t.priority)).forEach(task => {
            if (isLater(task)) {
              laterTasks.push(task)
            } else if (task.goal && task.goal.trim()) {
              const goalKey = task.goal.trim()
              if (!tasksByGoal.has(goalKey)) {
                tasksByGoal.set(goalKey, [])
              }
              tasksByGoal.get(goalKey)!.push(task)
            } else {
              ungroupedTasks.push(task)
            }
          })

          // Get sorted goal names for consistent ordering
          const goalNames = Array.from(tasksByGoal.keys()).sort()

          // Helper to check if a task is completed/done
          const isDone = (t: typeof tasks[0]) => {
            const s = t.stage?.toLowerCase() || ''
            return s === 'done' || s === 'complete' || s === 'completed' || s === 'skip' || s === 'skipped'
          }

          // Helper to check if a task needs a lead (open task = no lead AND not done)
          const needsLead = (t: typeof tasks[0]) => {
            if (isDone(t)) return false
            const lead = t.lead
            if (!lead) return true
            const trimmed = lead.trim()
            if (trimmed === '' || trimmed === '#N/A' || trimmed.toLowerCase() === 'n/a' || trimmed === '-' || trimmed.toLowerCase() === 'tbd') return true
            return false
          }

          // Filter helper for "show open only" mode
          const filterOpen = (list: typeof tasks) => showOpenOnly ? list.filter(needsLead) : list

          // Apply filter to all groups EXCEPT myTasks
          const filteredTopTasks = filterOpen(topTasks)
          const filteredUngroupedTasks = filterOpen(ungroupedTasks)
          const filteredLaterTasks = filterOpen(laterTasks)
          const filteredTasksByGoal = new Map<string, typeof tasks>()
          const filteredGoalNames: string[] = []
          for (const goalName of goalNames) {
            const filtered = filterOpen(tasksByGoal.get(goalName)!)
            if (filtered.length > 0) {
              filteredTasksByGoal.set(goalName, filtered)
              filteredGoalNames.push(goalName)
            }
          }

          const renderTaskCard = (task: typeof tasks[0], i: number) => {
            const taskNeedsLead = needsLead(task)
            const isClaiming = claimingTask === task.task
            // onion-15370: file number for dossier feel (FILE 01, 02, 03 …)
            const fileNo = String(i + 1).padStart(2, '0')

            return (
              <div
                key={i}
                className="paper-soft"
                style={{
                  ...itemCard(),
                  position: 'relative',
                  borderColor: 'hsl(var(--rule-warm) / 0.55)',
                  boxShadow: 'var(--shadow-soft)',
                  ...(taskNeedsLead ? {
                    background: 'hsl(var(--butter) / 0.15)',
                    borderColor: 'hsl(var(--butter))',
                    borderWidth: 2,
                  } : {}),
                }}
              >
                {/* onion-15370: editorial file number — dossier accent */}
                <p
                  className="overline"
                  style={{
                    margin: 0,
                    marginBottom: 6,
                    color: 'hsl(var(--foreground) / 0.5)',
                    fontSize: 10,
                    letterSpacing: '0.28em',
                  }}
                >
                  FILE · {fileNo}
                </p>
                {/* onion-15370: handwritten "claimed" / "open" stamp */}
                <span
                  aria-hidden
                  className="handwritten"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    transform: 'rotate(-7deg)',
                    fontSize: 14,
                    color: taskNeedsLead
                      ? 'hsl(var(--tomato))'
                      : 'hsl(142 71% 30%)',
                    opacity: 0.85,
                    pointerEvents: 'none',
                  }}
                >
                  {taskNeedsLead ? 'open' : 'claimed'}
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {task.priority && <span style={priorityBadge(task.priority)}>{task.priority}</span>}
                  {task.stage && <span style={stageBadge(task.stage)}>{task.stage}</span>}
                  {taskNeedsLead && (
                    <span style={needsLeadBadge()}>Needs Lead</span>
                  )}
                </div>
                <div style={{
                  marginTop: 8,
                  fontWeight: 600,
                  fontFamily: DISPLAY_FONT,
                  fontSize: 16,
                  letterSpacing: '-0.005em',
                  color: 'hsl(var(--foreground))',
                  // quattro-formaggi-54080: long task titles wrap rather
                  // than push the card width past the viewport.
                  overflowWrap: 'anywhere',
                }}>
                  {task.url ? (
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noreferrer"
                      style={inlineLink()}
                    >
                      {task.task}
                    </a>
                  ) : (
                    task.task
                  )}
                </div>
                {(task.lead && task.lead !== '#N/A') || task.dueDate ? (
                  <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 6 }}>
                    {task.lead && task.lead !== '#N/A' && (
                      <span>
                        Lead:{' '}
                        {task.leadId ? (
                          <Link
                            href={`/profile/${task.leadId}`}
                            style={tomatoLink()}
                          >
                            {task.lead}
                          </Link>
                        ) : (
                          task.lead
                        )}
                      </span>
                    )}
                    {task.lead && task.lead !== '#N/A' && task.dueDate && <span> • </span>}
                    {task.dueDate && <span>Due: {task.dueDate}</span>}
                  </div>
                ) : null}
                {task.notes && (
                  <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 4, fontStyle: 'italic' }}>
                    {task.notes}
                  </div>
                )}
                {taskNeedsLead && user && (
                  <button
                    onClick={() => handleClaimTask(task.task)}
                    disabled={isClaiming}
                    className="btn-pill"
                    style={{
                      marginTop: 10,
                      background: 'hsl(var(--tomato))',
                      color: 'hsl(var(--cream))',
                      border: '1px solid hsl(var(--tomato))',
                      // quattro-formaggi-54080: keep btn() minHeight 44 and
                      // bump font 12→14 so the button is readable on phones.
                      minHeight: 44,
                      padding: '8px 18px',
                      fontSize: 14,
                      opacity: isClaiming ? 0.5 : 1,
                      cursor: isClaiming ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isClaiming ? 'Claiming...' : 'Claim Task'}
                  </button>
                )}
                {!taskNeedsLead && user && task.leadId === user.memberId && (
                  <button
                    onClick={() => handleGiveUpTask(task.task)}
                    disabled={isClaiming}
                    style={{
                      ...btn('secondary', isClaiming),
                      marginTop: 10,
                      // quattro-formaggi-54080: keep btn() minHeight 44 and
                      // bump font 12→14 so the button is readable on phones.
                      padding: '8px 14px',
                      fontSize: 14,
                      borderColor: 'hsl(var(--tomato) / 0.35)',
                      color: 'hsl(var(--tomato))',
                      background: 'transparent',
                    }}
                  >
                    {isClaiming ? 'Giving up...' : 'Give Up'}
                  </button>
                )}
              </div>
            )
          }

          return (
            <div style={card()}>
              <h2 style={sectionTitle()}>
                {showOpenOnly
                  ? `Tasks (${tasks.filter(needsLead).length} open / ${tasks.length} total)`
                  : `Tasks (${tasks.length})`
                }
              </h2>

              {(() => {
                const openCount = tasks.filter(needsLead).length
                if (openCount === 0) return null
                return (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, fontSize: 14, color: 'hsl(var(--muted-foreground))', cursor: 'pointer', minHeight: 44, padding: '8px 0' }}>
                    <input
                      type="checkbox"
                      checked={showOpenOnly}
                      onChange={(e) => setShowOpenOnly(e.target.checked)}
                      // quattro-formaggi-54080: bump checkbox to 20px so the
                      // tap target on the input itself isn't sub-pinky.
                      style={{ cursor: 'pointer', accentColor: 'hsl(var(--tomato))', width: 20, height: 20 }}
                    />
                    Show open tasks only ({openCount})
                  </label>
                )
              })()}

              {myTasks.length > 0 && (
                <>
                  <h3
                    onClick={() => toggleSection('myTasks')}
                    style={collapsibleHeader('hsl(142 71% 30%)')}
                  >
                    <span>{collapsedSections.myTasks ? '▶' : '▼'} My Tasks ({myTasks.length})</span>
                  </h3>
                  {!collapsedSections.myTasks && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12, marginBottom: 24 }}>
                      {myTasks.map(renderTaskCard)}
                    </div>
                  )}
                </>
              )}

              {filteredTopTasks.length > 0 && (
                <>
                  <h3
                    onClick={() => toggleSection('topTasks')}
                    style={collapsibleHeader('hsl(var(--tomato))')}
                  >
                    <span>{collapsedSections.topTasks ? '▶' : '▼'} Top Tasks ({filteredTopTasks.length})</span>
                  </h3>
                  {!collapsedSections.topTasks && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12, marginBottom: 24 }}>
                      {filteredTopTasks.map(renderTaskCard)}
                    </div>
                  )}
                </>
              )}

              {/* Goal-based sections */}
              {filteredGoalNames.map((goalName, goalIndex) => {
                const goalTasks = filteredTasksByGoal.get(goalName)!
                const sectionKey = `goal_${goalIndex}`
                const isCollapsed = collapsedSections[sectionKey as keyof typeof collapsedSections] ?? true

                return (
                  <div key={goalName}>
                    <h3
                      onClick={() => toggleSection(sectionKey)}
                      style={collapsibleHeader('hsl(var(--foreground))')}
                    >
                      <span>{isCollapsed ? '▶' : '▼'} {goalName} ({goalTasks.length})</span>
                    </h3>
                    {!isCollapsed && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12, marginBottom: 24 }}>
                        {goalTasks.map(renderTaskCard)}
                      </div>
                    )}
                  </div>
                )
              })}

              {(filteredUngroupedTasks.length > 0 || filteredLaterTasks.length > 0) && (
                <>
                  <h3
                    onClick={() => toggleSection('otherTasks')}
                    style={collapsibleHeader('hsl(var(--muted-foreground))')}
                  >
                    <span>{collapsedSections.otherTasks ? '▶' : '▼'} Other Tasks ({filteredUngroupedTasks.length + (showLaterTasks ? filteredLaterTasks.length : 0)})</span>
                  </h3>
                  {!collapsedSections.otherTasks && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 }}>
                        {filteredUngroupedTasks.map(renderTaskCard)}
                        {showLaterTasks && filteredLaterTasks.map(renderTaskCard)}
                      </div>
                      {filteredLaterTasks.length > 0 && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, fontSize: 14, color: 'hsl(var(--muted-foreground))', cursor: 'pointer', minHeight: 44, padding: '8px 0' }}>
                          <input
                            type="checkbox"
                            checked={showLaterTasks}
                            onChange={(e) => setShowLaterTasks(e.target.checked)}
                            // quattro-formaggi-54080: 20px checkbox so the
                            // tap target on the input isn't sub-pinky.
                            style={{ cursor: 'pointer', accentColor: 'hsl(var(--tomato))', width: 20, height: 20 }}
                          />
                          Show &quot;Later&quot; tasks ({filteredLaterTasks.length})
                        </label>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )
        })()}

        {/* Manuals */}
        {manuals.length > 0 && (
          <div style={card()}>
            <h2
              onClick={() => toggleSection('manuals')}
              style={{ ...sectionTitle(), cursor: 'pointer', userSelect: 'none', minHeight: 44, display: 'flex', alignItems: 'center' }}
            >
              {collapsedSections.manuals ? '▶' : '▼'} Manuals ({manuals.length})
            </h2>
            {!collapsedSections.manuals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 }}>
                {manuals.map((manual, i) => (
                  <div key={i} style={itemCard(manual.status)}>
                    {manual.status && <span style={manualStatusBadge(manual.status)}>{manual.status}</span>}
                    <div style={{
                      fontWeight: 600,
                      fontSize: 15,
                      marginTop: manual.status ? 8 : 0,
                      fontFamily: DISPLAY_FONT,
                      letterSpacing: '-0.005em',
                    }}>
                      {manual.url ? (
                        <a
                          href={manual.url}
                          target="_blank"
                          rel="noreferrer"
                          style={inlineLink()}
                        >
                          {manual.title}
                        </a>
                      ) : (
                        manual.title
                      )}
                    </div>
                    {(manual.author || manual.lastUpdated) && (
                      <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 6 }}>
                        {manual.author && manual.author !== '#N/A' && <span>By {manual.author}</span>}
                        {manual.author && manual.author !== '#N/A' && manual.lastUpdated && <span> • </span>}
                        {manual.lastUpdated && <span>Updated: {manual.lastUpdated}</span>}
                      </div>
                    )}
                    {manual.notes && (
                      <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 4, fontStyle: 'italic' }}>
                        {manual.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Back link */}
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href="/" style={btn('secondary')}>← Back to Home</Link>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local style helpers — tuned for the crew detail page. Surface primitives
// (card / btn / badge / navBtn / pageContainer / loadingSpinner) come from
// @/app/ui/shared-styles so they stay in sync with the Phase 2 token system.
// ---------------------------------------------------------------------------

function sectionTitle(): React.CSSProperties {
  return {
    fontSize: 22,
    fontWeight: 700,
    marginTop: 0,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid hsl(var(--rule) / 0.12)',
    fontFamily: DISPLAY_FONT,
    letterSpacing: '-0.01em',
    color: 'hsl(var(--foreground))',
  }
}

function subSectionTitle(color: string): React.CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 700,
    color: color,
    marginBottom: 12,
    marginTop: 0,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  }
}

function th(): React.CSSProperties {
  return {
    textAlign: 'left',
    padding: '8px 12px',
    borderBottom: '2px solid hsl(var(--rule) / 0.12)',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'hsl(var(--muted-foreground))',
  }
}

function td(): React.CSSProperties {
  return {
    padding: '10px 12px',
    borderBottom: '1px solid hsl(var(--rule) / 0.10)',
    fontSize: 14,
    color: 'hsl(var(--foreground))',
  }
}

function memberCard(): React.CSSProperties {
  return {
    padding: 14,
    borderRadius: 'var(--radius)',
    border: '1px solid hsl(var(--rule) / 0.12)',
    background: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
    transition: 'border-color 150ms ease',
  }
}

function collapsibleHeader(color: string): React.CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 700,
    color: color,
    marginBottom: 12,
    marginTop: 0,
    cursor: 'pointer',
    userSelect: 'none',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    // quattro-formaggi-54080: 44px tap-target floor (WCAG 2.5.5) for
    // these collapsible h3 toggles. Padding + flex to align the chevron.
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    padding: '8px 0',
  }
}

function itemCard(priority?: string): React.CSSProperties {
  const lower = priority?.toLowerCase() || ''
  let borderColor = 'hsl(var(--rule) / 0.12)'
  let accent: string | null = null

  if (lower.includes('top') || lower.includes('high') || lower.includes('0.') || lower.includes('1.')) {
    accent = 'hsl(var(--tomato))'
  } else if (lower.includes('mid') || lower.includes('2.')) {
    accent = 'hsl(var(--butter))'
  } else if (lower.includes('complete')) {
    accent = 'hsl(142 71% 40%)'
  } else if (lower.includes('draft')) {
    accent = 'hsl(var(--butter))'
  } else if (lower.includes('needed')) {
    accent = 'hsl(var(--tomato))'
  }

  return {
    padding: 14,
    borderRadius: 'var(--radius)',
    border: `1px solid ${borderColor}`,
    borderLeft: accent ? `4px solid ${accent}` : `1px solid ${borderColor}`,
    background: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
  }
}

function statusBadge(status: string): React.CSSProperties {
  const lower = status.toLowerCase()
  let bg = 'hsl(var(--muted))'
  let color = 'hsl(var(--foreground))'

  if (lower.includes('lead') || lower.includes('capo')) {
    bg = 'hsl(var(--tomato) / 0.12)'
    color = 'hsl(var(--tomato))'
  } else if (lower.includes('active') || lower.includes('daily')) {
    bg = 'hsl(142 71% 35% / 0.12)'
    color = 'hsl(142 71% 30%)'
  } else if (lower.includes('weekly')) {
    bg = 'hsl(var(--butter) / 0.25)'
    color = 'hsl(var(--ink-soft))'
  }

  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    background: bg,
    color: color,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    whiteSpace: 'nowrap',
  }
}

function priorityBadge(priority: string): React.CSSProperties {
  const lower = priority?.toLowerCase() || ''
  let bg = 'hsl(var(--muted))'
  let color = 'hsl(var(--foreground))'

  if (lower.includes('top') || lower.includes('high') || lower.includes('0.') || lower.includes('1.')) {
    bg = 'hsl(var(--tomato) / 0.12)'
    color = 'hsl(var(--tomato))'
  } else if (lower.includes('mid') || lower.includes('2.')) {
    bg = 'hsl(var(--butter) / 0.25)'
    color = 'hsl(var(--ink-soft))'
  } else if (lower.includes('low')) {
    bg = 'hsl(var(--muted))'
    color = 'hsl(var(--muted-foreground))'
  }

  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    background: bg,
    color: color,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  }
}

function stageBadge(stage: string): React.CSSProperties {
  const lower = stage?.toLowerCase() || ''
  let bg = 'hsl(var(--muted))'
  let color = 'hsl(var(--muted-foreground))'

  if (lower.includes('now') || lower.includes('doing') || lower.includes('progress')) {
    bg = 'hsl(var(--butter) / 0.25)'
    color = 'hsl(var(--ink-soft))'
  } else if (lower.includes('done') || lower.includes('complete')) {
    bg = 'hsl(142 71% 35% / 0.12)'
    color = 'hsl(142 71% 30%)'
  } else if (lower.includes('todo') || lower.includes('next')) {
    bg = 'hsl(var(--muted))'
    color = 'hsl(var(--muted-foreground))'
  }

  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    background: bg,
    color: color,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  }
}

function needsLeadBadge(): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    background: 'hsl(var(--butter) / 0.35)',
    color: 'hsl(var(--ink))',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  }
}

function manualStatusBadge(status: string): React.CSSProperties {
  const lower = status?.toLowerCase() || ''
  let bg = 'hsl(var(--muted))'
  let color = 'hsl(var(--muted-foreground))'

  if (lower.includes('complete')) {
    bg = 'hsl(142 71% 35% / 0.12)'
    color = 'hsl(142 71% 30%)'
  } else if (lower.includes('draft')) {
    bg = 'hsl(var(--butter) / 0.25)'
    color = 'hsl(var(--ink-soft))'
  } else if (lower.includes('needed')) {
    bg = 'hsl(var(--tomato) / 0.12)'
    color = 'hsl(var(--tomato))'
  } else if (lower.includes('backlog')) {
    bg = 'hsl(var(--muted))'
    color = 'hsl(var(--muted-foreground))'
  }

  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    background: bg,
    color: color,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  }
}

function inlineLink(): React.CSSProperties {
  return {
    color: 'inherit',
    textDecoration: 'underline',
    textDecorationColor: 'hsl(var(--tomato) / 0.55)',
    textUnderlineOffset: '3px',
  }
}

function tomatoLink(): React.CSSProperties {
  return {
    color: 'hsl(var(--tomato))',
    textDecoration: 'none',
    fontWeight: 600,
    textUnderlineOffset: '2px',
  }
}

// Lightweight per-crew mission/description text for the visitor hero.
// Crew mappings don't ship a free-form description today, so we fall back to
// a generic line that still mentions the crew's role.
function visitorMissionLine(crewId: string, label: string): string {
  const map: Record<string, string> = {
    ops: 'Ops keeps PizzaDAO running — coordination, scheduling, and the unglamorous glue that makes everything else possible.',
    events: 'Events ships Global Pizza Party and PizzaDAO showings — flyers, venues, RSVPs, and pizza on the table.',
    tech: 'Tech builds and maintains the apps, bots, and infrastructure the rest of the DAO runs on.',
    creative: 'Creative is design, illustration, video, and brand — the look and feel of PizzaDAO.',
    biz_dev: 'Biz Dev opens doors with sponsors, partners, and brands — funding the slice.',
    education: 'Education translates DAO knowledge into onboarding, tutorials, and docs anyone can follow.',
    comms: 'Comms tells the PizzaDAO story — social, press, articles, podcasts, and brand voice.',
    latam: 'LATAM is the Latin America regional crew — local chapters, events, and Spanish/Portuguese culture.',
    africa: 'Africa is the regional crew for the continent — local chapters and pizza diplomacy.',
    music: 'Music programs the soundtrack — DJs, artists, and PizzaDAO Radio.',
    community: "Community is the welcoming committee — onboarding new members and keeping the vibe right.",
    governance: 'Governance designs and runs the DAO’s decision-making — proposals, voting, and policy.',
    real_estate: 'Real Estate scouts and stewards physical PizzaDAO spaces around the world.',
  }
  const key = crewId?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (
    map[key] ||
    `${label} is one of the working groups inside PizzaDAO. Hop in to find out what they’re cooking.`
  )
}
