'use client'

// Editorial restyle: § overline masthead, display-font day columns and
// paper-soft crew cards. Data loading, join/leave and login prompts are
// unchanged; the mobile/desktop split is now CSS (md:) instead of a resize
// listener, so the server-rendered markup matches on every viewport.

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { groupCrewsByDay } from '@/app/lib/crew-schedule'
import { useToast } from '@/app/ui/shared/Toast'
import { LoginPrompt } from '@/app/ui/shared/LoginPrompt'
import {
  EditorialMasthead,
  EditorialPage,
  LoadingLine,
  SectionHeading,
  paperCard,
  pillInk,
  pillOutline,
  pillTomato,
} from '@/app/ui/shared/Editorial'

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

/**
 * `initialCrews` comes from the server (app/crews/page.tsx, cached crew
 * mappings). When it is null the client fetches /api/crew-mappings itself.
 */
export default function CrewsClient({ initialCrews }: { initialCrews: CrewOption[] | null }) {
  const t = useTranslations('crewsPage')
  const [crews, setCrews] = useState<CrewOption[]>(initialCrews ?? [])
  const [loading, setLoading] = useState(!initialCrews)
  // True until we know whether the viewer is logged in (hides login nudges meanwhile).
  const [userLoading, setUserLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<UserData | null>(null)
  const [joining, setJoining] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<string | null>(null)
  const [loginPromptFor, setLoginPromptFor] = useState<string | null>(null)
  const toast = useToast()

  // Fetch crews and user data
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch crews (only when the server couldn't render them)
        if (!initialCrews) {
          const crewsRes = await fetch('/api/crew-mappings')
          if (!crewsRes.ok) throw new Error(t('loadError'))
          const crewsData = await crewsRes.json()
          setCrews(crewsData.crews || [])
        }

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
      } catch {
        setError(t('loadError'))
      } finally {
        setLoading(false)
        setUserLoading(false)
      }
    }
    fetchData()
  }, [initialCrews, t])

  // Group crews by day of week, separating "Other" crews
  const crewsByDay = useMemo(() => groupCrewsByDay(crews), [crews])
  const scheduledCrews = useMemo(() => crewsByDay.filter(g => g.day !== 'Other'), [crewsByDay])
  const otherCrews = useMemo(() => crewsByDay.find(g => g.day === 'Other')?.crews ?? [], [crewsByDay])

  const handleJoinCrew = async (crewId: string) => {
    if (!user) {
      setLoginPromptFor(crewId)
      return
    }

    setJoining(crewId)
    try {
      const res = await fetch('/api/join-crew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crewId, action: 'join' }),
      })

      if (!res.ok) throw new Error(t('joinError'))

      // Update local state
      setUser(prev => prev ? {
        ...prev,
        crews: [...prev.crews, crewId.toLowerCase()]
      } : null)

    } catch {
      toast.error(t('joinError'))
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

      if (!res.ok) throw new Error(t('leaveError'))

      // Update local state
      setUser(prev => prev ? {
        ...prev,
        crews: prev.crews.filter(c => c.toLowerCase() !== crewId.toLowerCase())
      } : null)

    } catch {
      toast.error(t('leaveError'))
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
      <article
        key={crew.id}
        className={`${paperCard} p-5 flex flex-col gap-4 transition-colors ${
          inCrew ? 'border-2 border-tomato' : 'hover:border-[hsl(var(--tomato)/0.55)]'
        }`}
        style={{ boxShadow: 'var(--shadow-soft)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3
              className="font-display font-black tracking-tight text-foreground leading-tight m-0"
              style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.4rem)', textWrap: 'balance' }}
            >
              {crew.emoji && <span aria-hidden className="mr-1.5">{crew.emoji}</span>}
              {crew.label}
            </h3>
            {(crew.callTime || crew.callLength) && (
              <p className="overline text-foreground/70 mt-2 mb-0">
                {crew.callTime && (
                  crew.callTimeUrl ? (
                    <a
                      href={crew.callTimeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-inherit underline decoration-[hsl(var(--tomato)/0.5)] underline-offset-2 hover:text-tomato-readable"
                    >
                      {crew.callTime}
                    </a>
                  ) : crew.callTime
                )}
                {crew.callTime && crew.callLength && <span aria-hidden className="mx-1.5 opacity-50">·</span>}
                {crew.callLength}
              </p>
            )}
          </div>
          {inCrew && (
            <span
              className="overline shrink-0 px-2 py-1 rounded-full bg-[hsl(var(--tomato)/0.12)] text-tomato-readable"
              style={{ fontSize: 13 }}
            >
              {t('joined')}
            </span>
          )}
        </div>

        <div className="flex gap-2.5">
          <Link href={`/crew/${crew.id}`} className={`${pillOutline} flex-1`}>
            {t('viewCrew')}
          </Link>

          {user && (
            inCrew ? (
              <button
                type="button"
                onClick={() => handleLeaveCrew(crew.id)}
                disabled={isLeaving}
                className={`${pillOutline} flex-1 !text-destructive !border-[hsl(var(--destructive)/0.5)] ${isLeaving ? 'cursor-wait' : ''}`}
              >
                {isLeaving ? t('leaving') : t('leaveCrew')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleJoinCrew(crew.id)}
                disabled={isJoining}
                className={`${pillInk} flex-1 ${isJoining ? 'cursor-wait' : ''}`}
              >
                {isJoining ? t('joining') : t('joinCrew')}
              </button>
            )
          )}
        </div>
        {loginPromptFor === crew.id && (
          <LoginPrompt message={t('loginPrompt')} onDismiss={() => setLoginPromptFor(null)} />
        )}

        {/* Tasks Section */}
        {crew.tasks && crew.tasks.length > 0 && (
          <div className="rule-warm pt-3">
            <p className="overline text-foreground/70 mt-0 mb-2">{t('topTasks')}</p>
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
              {crew.tasks.map((task, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  {task.priority && (
                    <span
                      className={`overline shrink-0 px-1.5 py-0.5 rounded-md mt-0.5 ${priorityClass(task.priority)}`}
                      style={{ fontSize: 13, letterSpacing: '0.12em' }}
                    >
                      {task.priority}
                    </span>
                  )}
                  {task.url ? (
                    <a
                      href={task.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm leading-snug text-foreground no-underline hover:text-tomato-readable min-h-[28px] flex items-center"
                    >
                      {task.label}
                    </a>
                  ) : (
                    <span className="text-sm leading-snug text-foreground">{task.label}</span>
                  )}
                </li>
              ))}
            </ul>
            {(crew.taskCount ?? 0) > 3 && (
              <p className="text-xs text-muted-foreground mt-2 mb-0 italic">
                {t('moreTasks', { count: (crew.taskCount ?? 0) - 3 })}
              </p>
            )}
          </div>
        )}

        {crew.sheet && (
          <a
            href={crew.sheet}
            target="_blank"
            rel="noreferrer"
            className="overline mt-auto inline-flex items-center min-h-11 text-foreground/70 no-underline hover:text-tomato-readable"
          >
            {t('openSheet')}
          </a>
        )}
      </article>
    )
  }

  if (loading) {
    return (
      <EditorialPage width="max-w-[1200px]">
        <LoadingLine label={t('loading')} />
      </EditorialPage>
    )
  }

  if (error) {
    return (
      <EditorialPage width="max-w-[640px]">
        <div className={`${paperCard} p-7 grid gap-3`} style={{ boxShadow: 'var(--shadow-soft)' }}>
          <p className="overline text-tomato-readable m-0">{t('error')}</p>
          <h1
            className="font-display font-black tracking-tight text-foreground m-0"
            style={{ fontSize: 'clamp(1.75rem, 5vw, 2.25rem)', lineHeight: 1.05 }}
          >
            {t('errorTitle')}
          </h1>
          <p className="text-muted-foreground m-0">{error}</p>
          <Link href="/" className={`${pillInk} justify-self-start`}>{t('home')}</Link>
        </div>
      </EditorialPage>
    )
  }

  return (
    <EditorialPage width="max-w-[1200px]">
      <EditorialMasthead
        overline={t('overline')}
        title={
          <>
            {t('titlePrefix')} <span className="text-tomato-readable underline-scribble">{t('titleAccent')}</span>
          </>
        }
        dek={
          <>
            {t('description')}{' '}
            {user ? t('welcome', { name: user.name }) : userLoading ? '' : t('loginHint')}
          </>
        }
      >
        <nav aria-label={t('pages')} className="flex flex-wrap gap-2.5">
          {user && (
            <Link href={`/dashboard/${user.memberId}`} className={pillOutline}>
              {t('dashboard')}
            </Link>
          )}
          <Link href="/crew" className={pillOutline}>
            {t('members')}
          </Link>
          <Link href="/manuals" className="btn-pill min-h-11 no-underline bg-butter text-ink border border-transparent hover:opacity-90">
            {t('manuals')}
          </Link>
        </nav>
      </EditorialMasthead>

      {/* Crews by day of week: stacked on mobile, side-by-side columns from md */}
      <section aria-label={t('schedule')} className="flex flex-col md:flex-row gap-6 md:items-start">
        {scheduledCrews.map(({ day, crews: dayCrews }) => (
          <div key={day} className="flex-1 min-w-0">
            <div className="mb-3 pb-2 border-b-2 border-foreground md:text-center">
              <p className="overline text-foreground/70 m-0">{t('every')}</p>
              <h2 className="font-display text-xl font-black tracking-tight text-foreground m-0">{t(`day${day}`)}</h2>
            </div>
            <div className="flex flex-col gap-3">
              {dayCrews.map(crew => renderCrewCard(crew as CrewOption))}
            </div>
          </div>
        ))}
      </section>

      {/* Other Crews Section */}
      {otherCrews.length > 0 && (
        <section className="mt-12">
          <SectionHeading overline={t('offCalendar')} title={t('otherCrews')} count={otherCrews.length} />
          <div className="rule-warm mb-4" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {otherCrews.map(crew => renderCrewCard(crew as CrewOption))}
          </div>
        </section>
      )}

      {/* Not logged in message */}
      {!user && !userLoading && (
        <div
          className={`${paperCard} mt-10 p-6 text-center grid justify-items-center gap-3`}
          style={{ boxShadow: 'var(--shadow-soft)' }}
        >
          <p className="font-display text-lg font-black text-foreground m-0">
            {t('loginTitle')}
          </p>
          <Link href="/login" className={pillTomato}>
            {t('login')}
          </Link>
        </div>
      )}
    </EditorialPage>
  )
}

function priorityClass(priority: string): string {
  switch (priority) {
    case 'Top':
      return 'bg-[hsl(var(--tomato)/0.15)] text-tomato-readable'
    case 'High':
      return 'bg-[hsl(32_95%_55%/0.16)] text-[hsl(28_90%_38%)] dark:text-[hsl(32_95%_65%)]'
    case 'Mid':
      return 'bg-[hsl(210_80%_55%/0.14)] text-[hsl(212_70%_38%)] dark:text-[hsl(210_80%_70%)]'
    default:
      return 'bg-[hsl(var(--ink)/0.06)] text-muted-foreground'
  }
}
