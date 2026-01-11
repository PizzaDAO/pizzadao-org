'use client'

import { use, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Inter } from 'next/font/google'

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
    task: string
    dueDate?: string
    lead?: string
    notes?: string
    url?: string
  }>
  agenda: Array<{
    time: string
    lead: string
    step: string
    action: string
    notes: string
  }>
  callInfo: {
    time: string
    song: string
    announcements: string
  } | null
}

export default function CrewPage({ params }: { params: Promise<{ crewId: string }> }) {
  const { crewId } = use(params)
  const [data, setData] = useState<CrewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingStage, setLoadingStage] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)

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
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    fetchCrew()
  }, [crewId])

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
        background: '#fafafa',
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
      background: '#fafafa',
      color: '#000',
      fontFamily: inter.style.fontFamily,
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: 24 }}>
        {/* Home Button */}
        <div>
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
        </header>

        {/* Agenda */}
        {agenda.length > 0 && (
          <div style={card()}>
            <h2 style={sectionTitle()}>Meeting Agenda</h2>
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
                    <td style={td()}>{item.step}</td>
                    <td style={td()}>{item.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  {member.turtles.split(',').map((t, j) => (
                    <span key={j} style={{
                      display: 'inline-block',
                      background: '#e8f5e9',
                      color: '#2e7d32',
                      padding: '2px 8px',
                      borderRadius: 12,
                      marginRight: 4,
                      marginBottom: 4,
                      fontSize: 11,
                      fontWeight: 500
                    }}>
                      {t.trim()}
                    </span>
                  ))}
                </div>
              )}
              {member.skills && (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                  <strong>Skills:</strong> {member.skills}
                </div>
              )}
              {member.org && (
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                  {member.org}
                </div>
              )}
            </div>
          )

          if (visibleRoster.length === 0) return null

          return (
            <div style={card()}>
              <h2 style={sectionTitle()}>Crew Roster ({visibleRoster.length} members)</h2>

              {activeMembers.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: '#2e7d32', marginBottom: 12, marginTop: 0 }}>
                    Active ({activeMembers.length})
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
                    {activeMembers.map(renderMemberCard)}
                  </div>
                </>
              )}

              {benchMembers.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: '#5c6bc0', marginBottom: 12, marginTop: 0 }}>
                    Bench ({benchMembers.length})
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 24 }}>
                    {benchMembers.map(renderMemberCard)}
                  </div>
                </>
              )}

              {otherMembers.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: '#757575', marginBottom: 12, marginTop: 0 }}>
                    Other ({otherMembers.length})
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                    {otherMembers.map(renderMemberCard)}
                  </div>
                </>
              )}
            </div>
          )
        })()}

        {/* Goals */}
        {goals.length > 0 && (
          <div style={card()}>
            <h2 style={sectionTitle()}>Goals</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {goals.map((goal, i) => (
                <div key={i} style={goalCard(goal.priority)}>
                  {goal.priority && (
                    <span style={priorityBadge(goal.priority)}>{goal.priority}</span>
                  )}
                  <span style={{ fontWeight: 500 }}>{goal.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tasks */}
        {tasks.length > 0 && (
          <div style={card()}>
            <h2 style={sectionTitle()}>Tasks</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {tasks.map((task, i) => (
                <div key={i} style={taskCard(task.stage)}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {task.priority && <span style={priorityBadge(task.priority)}>{task.priority}</span>}
                    {task.stage && <span style={stageBadge(task.stage)}>{task.stage}</span>}
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
                  {(task.lead || task.dueDate) && (
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                      {task.lead && <span>Lead: {task.lead}</span>}
                      {task.lead && task.dueDate && <span> • </span>}
                      {task.dueDate && <span>Due: {task.dueDate}</span>}
                    </div>
                  )}
                  {task.notes && (
                    <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{task.notes}</div>
                  )}
                </div>
              ))}
            </div>
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
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 14,
    padding: 24,
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
  }
  if (kind === 'primary') return { ...base, background: 'black', color: 'white', borderColor: 'black' }
  return { ...base, background: 'white', color: 'black' }
}

function badge(): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '6px 12px',
    borderRadius: 20,
    background: 'rgba(0,0,0,0.06)',
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
    borderBottom: '1px solid rgba(0,0,0,0.1)',
  }
}

function th(): React.CSSProperties {
  return {
    textAlign: 'left',
    padding: '8px 12px',
    borderBottom: '2px solid rgba(0,0,0,0.1)',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  }
}

function td(): React.CSSProperties {
  return {
    padding: '10px 12px',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    fontSize: 14,
  }
}

function memberCard(): React.CSSProperties {
  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.1)',
    background: '#fafafa',
  }
}

function statusBadge(status: string): React.CSSProperties {
  const lower = status.toLowerCase()
  let bg = 'rgba(0,0,0,0.1)'
  let color = '#333'

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
  let borderColor = 'rgba(0,0,0,0.1)'

  if (lower.includes('top') || lower.includes('high')) {
    borderColor = '#ff4d4d'
  } else if (lower.includes('mid')) {
    borderColor = '#ffa726'
  }

  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.1)',
    borderLeft: `4px solid ${borderColor}`,
    background: 'white',
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  }
}

function taskCard(stage: string): React.CSSProperties {
  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid rgba(0,0,0,0.1)',
    background: 'white',
  }
}

function priorityBadge(priority: string): React.CSSProperties {
  const lower = priority?.toLowerCase() || ''
  let bg = 'rgba(0,0,0,0.1)'
  let color = '#333'

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
  let bg = 'rgba(0,0,0,0.08)'
  let color = '#666'

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
