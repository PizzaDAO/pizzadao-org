'use client'

// Crew "Drafts" section (Comms compose): write tweet / LinkedIn / Discord /
// Telegram drafts, preview them, and post via X / LinkedIn share links
// (no X API: the intent link posts as whoever is logged in to X).
//
// Button visibility is advisory; every write route re-checks permissions
// (crew members edit + mark ready, leads / Dread Pizza Roberts mark posted
// and archive). Drafts are never deleted, only archived.

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { badge, btn, card, input } from '@/app/ui/shared-styles'
import {
  X_LIMIT,
  DRAFT_PLATFORMS,
  linkedinShareUrl,
  splitThread,
  xIntentUrl,
  xLength,
  xRemaining,
  type DraftPlatform,
  type DraftStatus,
} from '@/app/lib/draft-text'

export type CrewDraftView = {
  id: number
  platform: DraftPlatform
  text: string
  mediaUrl: string | null
  notes: string | null
  status: DraftStatus
  createdBy: string
  postedAt: string | null
  postedUrl: string | null
}

type Access = { member: boolean; manager: boolean }

const small: CSSProperties = { padding: '6px 12px', fontSize: 13, minHeight: 36 }
const label: CSSProperties = { display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))' }

function Counter({ text }: { text: string }) {
  const left = xRemaining(text)
  return (
    <span
      data-testid="x-counter"
      style={{ fontSize: 12, fontWeight: 600, color: left < 0 ? 'hsl(var(--tomato))' : 'hsl(var(--muted-foreground))' }}
    >
      {xLength(text)}/{X_LIMIT}
    </span>
  )
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...btn('primary'), ...small }}>
      {children}
    </a>
  )
}

export function CrewDrafts({ crewId }: { crewId: string }) {
  const t = useTranslations('crewDrafts')
  const base = `/api/crew/${encodeURIComponent(crewId)}/drafts`

  const [access, setAccess] = useState<Access | null>(null)
  const [drafts, setDrafts] = useState<CrewDraftView[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | 'new' | null>(null)

  // Compose / edit form (editingId = null means a new draft)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [platform, setPlatform] = useState<DraftPlatform>('x')
  const [text, setText] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [notes, setNotes] = useState('')

  const [postingId, setPostingId] = useState<number | null>(null)
  const [postedUrl, setPostedUrl] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}${showArchived ? '?archived=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) {
        setAccess(null)
        return
      }
      const data = await res.json()
      setAccess(data.access)
      setDrafts(data.drafts)
    } catch {
      setAccess(null)
    }
  }, [base, showArchived])

  useEffect(() => {
    void load()
  }, [load])

  // Non-members (or logged-out visitors) see nothing.
  if (!access?.member) return null

  const resetForm = () => {
    setEditingId(null)
    setText('')
    setMediaUrl('')
    setNotes('')
  }

  async function send(url: string, method: 'POST' | 'PATCH', body: unknown, id: number | 'new') {
    setBusy(id)
    setError('')
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || t('genericError'))
        return false
      }
      await load()
      return true
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!text.trim()) return
    const body = { platform, text, mediaUrl, notes }
    const ok =
      editingId === null
        ? await send(base, 'POST', body, 'new')
        : await send(`${base}/${editingId}`, 'PATCH', body, editingId)
    if (ok) resetForm()
  }

  const startEdit = (d: CrewDraftView) => {
    setEditingId(d.id)
    setPlatform(d.platform)
    setText(d.text)
    setMediaUrl(d.mediaUrl ?? '')
    setNotes(d.notes ?? '')
  }

  const setStatus = (d: CrewDraftView, status: DraftStatus, extra: Record<string, unknown> = {}) =>
    send(`${base}/${d.id}`, 'PATCH', { status, ...extra }, d.id)

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {
      setError(t('copyFailed'))
    }
  }

  const statusLabel = (s: DraftStatus) => t(`status.${s}`)

  return (
    <div style={card()} data-testid="crew-drafts">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{t('title')}</h2>
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('showArchived')}
        </label>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>{t('intro')}</p>

      {error && (
        <div role="alert" style={{ color: 'hsl(var(--tomato))', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Compose */}
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={label}>
          {t('platform')}
          <select value={platform} onChange={(e) => setPlatform(e.target.value as DraftPlatform)} style={input()}>
            {DRAFT_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {t(`platforms.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label style={label}>
          {editingId === null ? t('compose') : t('editing')}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={t('placeholder')}
            style={{ ...input(), resize: 'vertical' }}
          />
        </label>
        {platform === 'x' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <Counter text={text} />
            {xLength(text) > X_LIMIT && (
              <span style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>{t('tooLongHint')}</span>
            )}
          </div>
        )}
        <label style={label}>
          {t('mediaUrl')}
          <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://" style={input()} />
        </label>
        <label style={label}>
          {t('notes')}
          <input value={notes} onChange={(e) => setNotes(e.target.value)} style={input()} />
        </label>
        {text.trim() && (
          <div aria-label={t('preview')} style={{ border: '1px dashed hsl(var(--rule) / 0.3)', borderRadius: 'var(--radius)', padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>{t('preview')}</div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={save} disabled={!text.trim() || busy !== null} style={btn('accent', !text.trim() || busy !== null)}>
            {editingId === null ? t('saveDraft') : t('saveChanges')}
          </button>
          {editingId !== null && (
            <button type="button" onClick={resetForm} style={btn('secondary')}>
              {t('cancelEdit')}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {drafts.length === 0 ? (
        <p style={{ margin: 0, color: 'hsl(var(--muted-foreground))' }}>{t('empty')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {drafts.map((d) => {
            const editable = d.status === 'draft' || d.status === 'ready'
            const parts = d.platform === 'x' && xLength(d.text) > X_LIMIT ? splitThread(d.text) : null
            return (
              <div key={d.id} data-testid={`draft-${d.id}`} style={{ border: '1px solid hsl(var(--rule) / 0.15)', borderRadius: 'var(--radius)', padding: 12, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={badge()}>{t(`platforms.${d.platform}`)}</span>
                  <span style={badge(d.status === 'ready' ? 'accent' : 'default')}>{statusLabel(d.status)}</span>
                  {d.platform === 'x' && <Counter text={d.text} />}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{d.text}</div>
                {d.mediaUrl && (
                  <a href={d.mediaUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                    {t('media')}
                  </a>
                )}
                {d.notes && <div style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>{d.notes}</div>}
                {d.postedUrl && (
                  <a href={d.postedUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                    {t('viewPost')}
                  </a>
                )}

                {parts && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{t('thread', { count: parts.length })}</div>
                    {parts.map((p, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 220px', whiteSpace: 'pre-wrap', fontSize: 13 }}>{p}</div>
                        <LinkButton href={xIntentUrl(p)}>{t('postPartOnX', { n: i + 1 })}</LinkButton>
                        <button type="button" style={{ ...btn('secondary'), ...small }} onClick={() => copy(`${d.id}-${i}`, p)}>
                          {copied === `${d.id}-${i}` ? t('copied') : t('copy')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {d.platform === 'x' && !parts && <LinkButton href={xIntentUrl(d.text)}>{t('postOnX')}</LinkButton>}
                  {d.platform === 'linkedin' && <LinkButton href={linkedinShareUrl(d.text)}>{t('postOnLinkedIn')}</LinkButton>}
                  <button type="button" style={{ ...btn('secondary'), ...small }} onClick={() => copy(String(d.id), d.text)}>
                    {copied === String(d.id) ? t('copied') : t('copy')}
                  </button>
                  {editable && (
                    <button type="button" style={{ ...btn('secondary'), ...small }} onClick={() => startEdit(d)}>
                      {t('edit')}
                    </button>
                  )}
                  {d.status === 'draft' && (
                    <button type="button" disabled={busy === d.id} style={{ ...btn('secondary'), ...small }} onClick={() => setStatus(d, 'ready')}>
                      {t('markReady')}
                    </button>
                  )}
                  {d.status === 'ready' && (
                    <button type="button" disabled={busy === d.id} style={{ ...btn('secondary'), ...small }} onClick={() => setStatus(d, 'draft')}>
                      {t('backToDraft')}
                    </button>
                  )}
                  {access.manager && d.status === 'ready' && (
                    <button type="button" style={{ ...btn('primary'), ...small }} onClick={() => { setPostingId(d.id); setPostedUrl('') }}>
                      {t('markPosted')}
                    </button>
                  )}
                  {access.manager && d.status !== 'archived' && (
                    <button type="button" disabled={busy === d.id} style={{ ...btn('secondary'), ...small }} onClick={() => setStatus(d, 'archived')}>
                      {t('archive')}
                    </button>
                  )}
                  {access.manager && d.status === 'archived' && (
                    <button type="button" disabled={busy === d.id} style={{ ...btn('secondary'), ...small }} onClick={() => setStatus(d, 'draft')}>
                      {t('restore')}
                    </button>
                  )}
                </div>

                {postingId === d.id && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={label}>
                      {t('postedUrl')}
                      <input value={postedUrl} onChange={(e) => setPostedUrl(e.target.value)} placeholder="https://x.com/..." style={input()} />
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        style={{ ...btn('accent'), ...small }}
                        onClick={async () => {
                          if (await setStatus(d, 'posted', { postedUrl })) setPostingId(null)
                        }}
                      >
                        {t('confirmPosted')}
                      </button>
                      <button type="button" style={{ ...btn('secondary'), ...small }} onClick={() => setPostingId(null)}>
                        {t('cancelEdit')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
