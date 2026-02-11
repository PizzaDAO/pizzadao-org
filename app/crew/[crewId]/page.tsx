'use client'

import { use, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Inter } from 'next/font/google'
import { TURTLES } from '@/app/ui/constants'

const inter = Inter({ subsets: ['latin'] })

// Loading stages to show progress
const LOADING_STAGES = [
  'Connecting to server...',
  'Loading crew info...',
  'Fetching roster...',
  'Loading tasks...',
  'Almost ready...',
]

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

export default function CrewPage({ params }: { params: Promise<{ crewId: string }> }) {
  const { crewId } = use(params)
  const [data, setData] = useState<CrewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingStage, setLoadingStage] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [user, setUser] = useState<UserData | null>(null)
  const [joining, setJoining] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [manuals, setManuals] = useState<Manual[]>([])

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
          <p style={{ fontSize: 18, opacity: 0.8, marginBottom: 8 }}>
            {LOADING_STAGES[loadingStage]}
          </p>
          <p style={{ fontSize: 13, opacity: 0.5 }}>
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
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-page-bg)',
        fontFamily: inter.style.fontFamily,
        padding: 20,
      }}>
        <div style={card()}>
          <h1 style={{ fontSize: 24, marginBottom: 16 }}>Crew Not Found</h1>
          <p style={{ opacity: 0.7, marginBottom: 32 }}>{error || 'Could not load crew data'}</p>
          <Link href="/" style={btn('primary')}>Back to Home</Link>
        </div>
      </div>
    )
  }

  const { crew, roster, goals, tasks, agenda, callInfo } = data

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
          <Link href="/" style={{
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
          }}>
            ← Home
          </Link>
          <Link href="/crews" style={{
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
          }}>
            All Crews
          </Link>
          {crewId.toLowerCase() === 'tech' && (
            <Link href="/tech/projects" style={{
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
            }}>
              Projects
            </Link>
          )}
          {crewId.toLowerCase() === 'comms' && (
            <a href="https://pizzadao.xyz/brand" target="_blank" rel="noreferrer" style={{
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
            }}>
              Brand Kit
            </a>
          )}
          {user && (
            <Link href={`/dashboard/${user.memberId}`} style={{
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
            }}>
              My Dashboard
            </Link>
          )}
        </div>

        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{crew.emoji || '🍕'}</div>
          <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>{crew.label}</h1>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            {crew.callTime && (
              crew.callTimeUrl ? (
                <a href={crew.callTimeUrl} target="_blank" rel="noreferrer" style={{ ...badge(), textDecoration: 'none' }}>
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
              <a href={crew.sheet} target="_blank" rel="noreferrer" style={{ ...badge(), textDecoration: 'none' }}>
                📊 Open Sheet
              </a>
            )}
          </div>

          {/* Join/Leave Crew Button */}
          <div style={{ marginTop: 20 }}>
            {user ? (
              isInCrew ? (
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{
                    background: 'rgba(76,175,80,0.15)',
                    color: '#2e7d32',
                    padding: '8px 16px',
                    borderRadius: 20,
                    fontSize: 14,
                    fontWeight: 600,
                  }}>
                    You're a member of this crew
                  </span>
                  <button
                    onClick={handleLeaveCrew}
                    disabled={leaving}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 10,
                      border: '1px solid #d32f2f',
                      background: 'var(--color-surface)',
                      color: '#d32f2f',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: leaving ? 'wait' : 'pointer',
                      opacity: leaving ? 0.6 : 1,
                    }}
                  >
                    {leaving ? 'Leaving...' : 'Leave Crew'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleJoinCrew}
                  disabled={joining}
                  style={{
                    padding: '12px 24px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'var(--color-btn-primary-bg)',
                    color: 'var(--color-btn-primary-text)',
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: joining ? 'wait' : 'pointer',
                    opacity: joining ? 0.6 : 1,
                  }}
                >
                  {joining ? 'Joining...' : 'Join This Crew'}
                </button>
              )
            ) : (
              <p style={{ fontSize: 14, opacity: 0.6 }}>
                <Link href="/" style={{ color: '#ff4d4d' }}>Log in</Link> to join this crew
              </p>
            )}
          </div>
        </header>

        {/* Agenda */}
        {agenda.length > 0 && (
          <div style={card()}>
            <h2
              onClick={() => toggleSection('agenda')}
              style={{ ...sectionTitle(), cursor: 'pointer', userSelect: 'none' }}
            >
              {collapsedSections.agenda ? '▶' : '▼'} Meeting Agenda ({agenda.length})
            </h2>
            {!collapsedSections.agenda && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
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
                            style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' }}
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
            <div key={i} style={memberCard()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <Link
                    href={`/profile/${member.id}`}
                    style={{ fontWeight: 700, fontSize: 16, color: 'inherit', textDecoration: 'none' }}
                    onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                    onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                  >
                    {member.name}
                  </Link>
                  {member.city && <div style={{ fontSize: 13, opacity: 0.7 }}>{member.city}</div>}
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
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                  <strong>Skills:</strong> {member.skills}
                </div>
              )}
              {member.org && (
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                  <strong>Orgs:</strong> {member.org}
                </div>
              )}
            </div>
          )

          if (visibleRoster.length === 0) return null

          return (
            <div style={card()}>
              <h2
                onClick={() => toggleSection('roster')}
                style={{ ...sectionTitle(), cursor: 'pointer', userSelect: 'none' }}
              >
                {collapsedSections.roster ? '▶' : '▼'} Crew Roster ({visibleRoster.length} members)
              </h2>

              {!collapsedSections.roster && activeMembers.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2e7d32', marginBottom: 12, marginTop: 0 }}>
                    Active ({activeMembers.length})
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
                    {activeMembers.map(renderMemberCard)}
                  </div>
                </>
              )}

              {!collapsedSections.roster && benchMembers.length > 0 && (
                <>
                  <h3
                    onClick={() => toggleSection('bench')}
                    style={collapsibleHeader('#5c6bc0')}
                  >
                    <span>{collapsedSections.bench ? '▶' : '▼'} Bench ({benchMembers.length})</span>
                  </h3>
                  {!collapsedSections.bench && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
                      {benchMembers.map(renderMemberCard)}
                    </div>
                  )}
                </>
              )}

              {!collapsedSections.roster && otherMembers.length > 0 && (
                <>
                  <h3
                    onClick={() => toggleSection('other')}
                    style={collapsibleHeader('#757575')}
                  >
                    <span>{collapsedSections.other ? '▶' : '▼'} Other ({otherMembers.length})</span>
                  </h3>
                  {!collapsedSections.other && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
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
              style={{ ...sectionTitle(), cursor: 'pointer', userSelect: 'none' }}
            >
              {collapsedSections.goals ? '▶' : '▼'} Goals ({goals.length})
            </h2>
            {!collapsedSections.goals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
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

            return (
              <div key={i} style={{
                ...itemCard(),
                ...(taskNeedsLead ? {
                  background: 'rgba(255,179,0,0.1)',
                  borderColor: '#ffb300',
                  borderWidth: '2px',
                } : {}),
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {task.priority && <span style={priorityBadge(task.priority)}>{task.priority}</span>}
                  {task.stage && <span style={stageBadge(task.stage)}>{task.stage}</span>}
                  {taskNeedsLead && <span style={{
                    display: 'inline-block',
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    background: 'rgba(255,179,0,0.2)',
                    color: '#ff8f00',
                    textTransform: 'uppercase',
                  }}>Needs Lead</span>}
                </div>
                <div style={{ marginTop: 8, fontWeight: 500 }}>
                  {task.url ? (
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                    >
                      {task.task}
                    </a>
                  ) : (
                    task.task
                  )}
                </div>
                {(task.lead && task.lead !== '#N/A') || task.dueDate ? (
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                    {task.lead && task.lead !== '#N/A' && (
                      <span>Lead: {task.leadId ? (
                        <Link
                          href={`/profile/${task.leadId}`}
                          style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                        >
                          {task.lead}
                        </Link>
                      ) : (
                        task.lead
                      )}</span>
                    )}
                    {task.lead && task.lead !== '#N/A' && task.dueDate && <span> • </span>}
                    {task.dueDate && <span>Due: {task.dueDate}</span>}
                  </div>
                ) : null}
                {task.notes && (
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{task.notes}</div>
                )}
                {taskNeedsLead && user && (
                  <button
                    onClick={() => handleClaimTask(task.task)}
                    disabled={isClaiming}
                    style={{
                      marginTop: 10,
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: '#ff8f00',
                      color: 'var(--color-btn-primary-text)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isClaiming ? 'wait' : 'pointer',
                      opacity: isClaiming ? 0.6 : 1,
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
                      marginTop: 10,
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid #d32f2f',
                      background: 'var(--color-surface)',
                      color: '#d32f2f',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isClaiming ? 'wait' : 'pointer',
                      opacity: isClaiming ? 0.6 : 1,
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
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13, opacity: 0.7, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showOpenOnly}
                      onChange={(e) => setShowOpenOnly(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    Show open tasks only ({openCount})
                  </label>
                )
              })()}

              {myTasks.length > 0 && (
                <>
                  <h3
                    onClick={() => toggleSection('myTasks')}
                    style={collapsibleHeader('#2e7d32')}
                  >
                    <span>{collapsedSections.myTasks ? '▶' : '▼'} My Tasks ({myTasks.length})</span>
                  </h3>
                  {!collapsedSections.myTasks && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
                      {myTasks.map(renderTaskCard)}
                    </div>
                  )}
                </>
              )}

              {filteredTopTasks.length > 0 && (
                <>
                  <h3
                    onClick={() => toggleSection('topTasks')}
                    style={collapsibleHeader('#d32f2f')}
                  >
                    <span>{collapsedSections.topTasks ? '▶' : '▼'} Top Tasks ({filteredTopTasks.length})</span>
                  </h3>
                  {!collapsedSections.topTasks && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
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
                      style={collapsibleHeader('#1565c0')}
                    >
                      <span>{isCollapsed ? '▶' : '▼'} {goalName} ({goalTasks.length})</span>
                    </h3>
                    {!isCollapsed && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
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
                    style={collapsibleHeader('#757575')}
                  >
                    <span>{collapsedSections.otherTasks ? '▶' : '▼'} Other Tasks ({filteredUngroupedTasks.length + (showLaterTasks ? filteredLaterTasks.length : 0)})</span>
                  </h3>
                  {!collapsedSections.otherTasks && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                        {filteredUngroupedTasks.map(renderTaskCard)}
                        {showLaterTasks && filteredLaterTasks.map(renderTaskCard)}
                      </div>
                      {filteredLaterTasks.length > 0 && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, opacity: 0.7, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={showLaterTasks}
                            onChange={(e) => setShowLaterTasks(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                          />
                          Show "Later" tasks ({filteredLaterTasks.length})
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
              style={{ ...sectionTitle(), cursor: 'pointer', userSelect: 'none' }}
            >
              {collapsedSections.manuals ? '▶' : '▼'} Manuals ({manuals.length})
            </h2>
            {!collapsedSections.manuals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {manuals.map((manual, i) => (
                  <div key={i} style={itemCard(manual.status)}>
                    {manual.status && <span style={manualStatusBadge(manual.status)}>{manual.status}</span>}
                    <div style={{ fontWeight: 600, fontSize: 15, marginTop: manual.status ? 8 : 0 }}>
                      {manual.url ? (
                        <a
                          href={manual.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                        >
                          {manual.title}
                        </a>
                      ) : (
                        manual.title
                      )}
                    </div>
                    {(manual.author || manual.lastUpdated) && (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                        {manual.author && manual.author !== '#N/A' && <span>By {manual.author}</span>}
                        {manual.author && manual.author !== '#N/A' && manual.lastUpdated && <span> • </span>}
                        {manual.lastUpdated && <span>Updated: {manual.lastUpdated}</span>}
                      </div>
                    )}
                    {manual.notes && (
                      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{manual.notes}</div>
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

function badge(): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '6px 12px',
    borderRadius: 20,
    background: 'var(--color-surface-hover)',
    fontSize: 13,
    fontWeight: 500,
  }
}

function sectionTitle(): React.CSSProperties {
  return {
    fontSize: 20,
    fontWeight: 700,
    marginTop: 0,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid var(--color-divider)',
  }
}

function th(): React.CSSProperties {
  return {
    textAlign: 'left',
    padding: '8px 12px',
    borderBottom: '2px solid var(--color-divider)',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  }
}

function td(): React.CSSProperties {
  return {
    padding: '10px 12px',
    borderBottom: '1px solid var(--color-divider)',
    fontSize: 14,
  }
}

function memberCard(): React.CSSProperties {
  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--color-border)',
    background: 'var(--color-page-bg)',
  }
}

function collapsibleHeader(color: string): React.CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 600,
    color: color,
    marginBottom: 12,
    marginTop: 0,
    cursor: 'pointer',
    userSelect: 'none',
  }
}

function itemCard(priority?: string): React.CSSProperties {
  const lower = priority?.toLowerCase() || ''
  let borderColor = 'var(--color-border)'

  if (lower.includes('top') || lower.includes('high') || lower.includes('0.') || lower.includes('1.')) {
    borderColor = '#ff4d4d'
  } else if (lower.includes('mid') || lower.includes('2.')) {
    borderColor = '#ffa726'
  } else if (lower.includes('complete')) {
    borderColor = '#4caf50'
  } else if (lower.includes('draft')) {
    borderColor = '#ff9800'
  } else if (lower.includes('needed')) {
    borderColor = '#f44336'
  }

  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--color-border)',
    borderLeft: `4px solid ${borderColor}`,
    background: 'var(--color-page-bg)',
  }
}

function statusBadge(status: string): React.CSSProperties {
  const lower = status.toLowerCase()
  let bg = 'var(--color-surface-hover)'
  let color = 'var(--color-text-primary)'

  if (lower.includes('lead') || lower.includes('capo')) {
    bg = 'rgba(255,77,77,0.15)'
    color = '#d32f2f'
  } else if (lower.includes('active') || lower.includes('daily')) {
    bg = 'rgba(76,175,80,0.15)'
    color = '#2e7d32'
  } else if (lower.includes('weekly')) {
    bg = 'rgba(33,150,243,0.15)'
    color = '#1565c0'
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
  }
}

function goalCard(priority: string): React.CSSProperties {
  const lower = priority?.toLowerCase() || ''
  let borderColor = 'var(--color-border)'

  if (lower.includes('top') || lower.includes('high')) {
    borderColor = '#ff4d4d'
  } else if (lower.includes('mid')) {
    borderColor = '#ffa726'
  }

  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--color-border)',
    borderLeft: `4px solid ${borderColor}`,
    background: 'var(--color-surface)',
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  }
}

function taskCard(stage: string): React.CSSProperties {
  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
  }
}

function priorityBadge(priority: string): React.CSSProperties {
  const lower = priority?.toLowerCase() || ''
  let bg = 'var(--color-surface-hover)'
  let color = 'var(--color-text-primary)'

  if (lower.includes('top') || lower.includes('high')) {
    bg = 'rgba(255,77,77,0.15)'
    color = '#d32f2f'
  } else if (lower.includes('mid')) {
    bg = 'rgba(255,167,38,0.15)'
    color = '#ef6c00'
  } else if (lower.includes('low')) {
    bg = 'rgba(76,175,80,0.15)'
    color = '#2e7d32'
  }

  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700,
    background: bg,
    color: color,
    textTransform: 'uppercase',
  }
}

function stageBadge(stage: string): React.CSSProperties {
  const lower = stage?.toLowerCase() || ''
  let bg = 'var(--color-surface-hover)'
  let color = 'var(--color-text-secondary)'

  if (lower.includes('now') || lower.includes('doing') || lower.includes('progress')) {
    bg = 'rgba(33,150,243,0.15)'
    color = '#1565c0'
  } else if (lower.includes('done') || lower.includes('complete')) {
    bg = 'rgba(76,175,80,0.15)'
    color = '#2e7d32'
  } else if (lower.includes('todo') || lower.includes('next')) {
    bg = 'rgba(156,39,176,0.15)'
    color = '#7b1fa2'
  }

  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700,
    background: bg,
    color: color,
    textTransform: 'uppercase',
  }
}

function manualCard(status: string): React.CSSProperties {
  const lower = status?.toLowerCase() || ''
  let borderColor = 'var(--color-border)'

  if (lower.includes('complete')) {
    borderColor = '#4caf50'
  } else if (lower.includes('draft')) {
    borderColor = '#ff9800'
  } else if (lower.includes('needed')) {
    borderColor = '#f44336'
  }

  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--color-border)',
    borderLeft: `4px solid ${borderColor}`,
    background: 'var(--color-surface)',
  }
}

function manualStatusBadge(status: string): React.CSSProperties {
  const lower = status?.toLowerCase() || ''
  let bg = 'var(--color-surface-hover)'
  let color = 'var(--color-text-secondary)'

  if (lower.includes('complete')) {
    bg = 'rgba(76,175,80,0.15)'
    color = '#2e7d32'
  } else if (lower.includes('draft')) {
    bg = 'rgba(255,152,0,0.15)'
    color = '#ef6c00'
  } else if (lower.includes('needed')) {
    bg = 'rgba(244,67,54,0.15)'
    color = '#d32f2f'
  } else if (lower.includes('backlog')) {
    bg = 'rgba(156,39,176,0.15)'
    color = '#7b1fa2'
  }

  return {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700,
    background: bg,
    color: color,
    textTransform: 'uppercase',
  }
}
