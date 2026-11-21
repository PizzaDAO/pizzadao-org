'use client'

// "Start crew call" button (plans/neapolitan-96018.md). Shown only to members the API says may press it
// (crew leads, capos, admins; optionally any crew member) and only while crewCall.startEnabled is on.
// The server decides everything; this just shows the state. Metalhead records on its own once someone
// is in the voice channel, so after a start we poll the live view for up to 3 minutes and show "Recording".

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { badge, btn } from '@/app/ui/shared-styles'

type Info = { canStart: boolean; state?: string; voiceUrl?: string | null; nextCallMs?: number | null; otherCrewLabel?: string | null }

const POLL_MS = 10_000
const POLL_FOR_MS = 3 * 60_000
const note: CSSProperties = { fontSize: 13, color: 'hsl(var(--muted-foreground))' }

export function CrewCallStart({ crewId }: { crewId: string }) {
  const t = useTranslations('crewCallStart')
  const base = `/api/crew/${encodeURIComponent(crewId)}/call/start`
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(false)
  const [preview, setPreview] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    fetch(base, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Info | null) => {
        if (!alive) return
        setInfo(d)
        setVoiceUrl(d?.voiceUrl ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (timer.current) clearInterval(timer.current)
    }
  }, [base])

  const watchRecording = useCallback(() => {
    const until = Date.now() + POLL_FOR_MS
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(async () => {
      if (Date.now() > until) {
        if (timer.current) clearInterval(timer.current)
        return
      }
      try {
        const res = await fetch('/api/calls/live', { cache: 'no-store' })
        const d = (await res.json()) as { calls?: Array<{ crewId: string | null }> }
        if (d.calls?.some((c) => c.crewId === crewId)) {
          setRecording(true)
          if (timer.current) clearInterval(timer.current)
        }
      } catch {
        /* keep polling until the time is up */
      }
    }, POLL_MS)
  }, [crewId])

  if (!info?.canStart) return null

  async function start() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const d = (await res.json().catch(() => ({}))) as { status?: string; voiceUrl?: string | null; otherCrewLabel?: string; nextCallMs?: number | null; by?: string }
      if (d.voiceUrl) setVoiceUrl(d.voiceUrl)
      if (d.status === 'started') {
        setStarted(true)
        watchRecording()
      } else if (d.status === 'preview') {
        setPreview(true)
      } else if (d.status === 'already_live' || d.status === 'already_started') {
        setStarted(true)
      } else if (res.status === 429) {
        setError(t('errors.rateLimited'))
      } else {
        setError(t(`errors.${d.status && KNOWN.has(d.status) ? d.status : 'generic'}`))
      }
    } catch {
      setError(t('errors.generic'))
    } finally {
      setBusy(false)
    }
  }

  const live = started || info.state === 'live'
  const blocked = info.state === 'busy' || info.state === 'cooldown' || info.state === 'unavailable' || info.state === 'not_scheduled'

  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
      {live ? (
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={badge('accent')}>{recording ? t('recording') : t('live')}</span>
          {voiceUrl && (
            <a href={voiceUrl} target="_blank" rel="noopener noreferrer" style={{ ...badge(), textDecoration: 'none' }}>
              {t('joinVoice')}
            </a>
          )}
          <Link href="/calls/live" style={{ ...badge(), textDecoration: 'none' }}>
            {t('openLive')}
          </Link>
        </span>
      ) : (
        <button type="button" onClick={start} disabled={busy || blocked || preview} style={btn('primary', busy || blocked || preview)}>
          {busy ? t('starting') : t('start')}
        </button>
      )}
      {live && !recording && <span style={note}>{t('joinHint')}</span>}
      {preview && <span style={note}>{t('previewNote')}</span>}
      {!live && info.state === 'busy' && <span style={note}>{info.otherCrewLabel ? t('busyNamed', { crew: info.otherCrewLabel }) : t('errors.channel_busy')}</span>}
      {!live && info.state === 'cooldown' && <span style={note}>{t('errors.cooldown')}</span>}
      {!live && info.state === 'unavailable' && <span style={note}>{t('errors.not_recordable')}</span>}
      {!live && info.state === 'not_scheduled' && (
        <span style={note}>{info.nextCallMs ? t('errors.not_scheduledNext', { when: new Date(info.nextCallMs).toLocaleString() }) : t('errors.not_scheduled')}</span>
      )}
      {error && (
        <span role="alert" style={{ ...note, color: 'hsl(var(--destructive, 0 70% 50%))' }}>
          {error}
        </span>
      )}
    </div>
  )
}

const KNOWN = new Set(['already_live', 'channel_busy', 'cooldown', 'not_scheduled', 'not_recordable', 'discord_failed'])
