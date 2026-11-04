'use client'

// "Updates from the last call": task changes proposed from a call's transcript (plans/post-call-agenda-updates.md,
// ask 2) for a crew lead or admin to review. Nothing here changes a task until a click. Used on the crew page
// (all pending proposals of the crew) and on /admin/calls/<id> (the ones from that call, shown even when empty).
// Visibility is advisory: the API re-checks that the viewer leads the crew (or is an admin) and fails closed,
// so anyone else simply sees nothing.

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { badge, btn, card, input } from '@/app/ui/shared-styles'
import type { ProposalView } from '@/app/lib/call-tasks/view'

const small: CSSProperties = { padding: '6px 12px', fontSize: 13, minHeight: 36 }
const muted: CSSProperties = { fontSize: 13, color: 'hsl(var(--muted-foreground))' }
const field: CSSProperties = { display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))' }

type EditFields = { label: string; stage: string; priority: string; due: string; leadName: string }
type Edit = EditFields & { orig: EditFields }

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v))
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

export function CrewCallUpdates({ crewId, recordingId, showEmpty = false, onApplied }: { crewId: string; recordingId?: string; showEmpty?: boolean; onApplied?: () => void }) {
  const t = useTranslations('crewCallUpdates')
  const base = `/api/crew/${encodeURIComponent(crewId)}/proposals`
  const [rows, setRows] = useState<ProposalView[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [confirmForce, setConfirmForce] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}${recordingId ? `?recordingId=${encodeURIComponent(recordingId)}` : ''}`, { cache: 'no-store' })
      if (!res.ok) {
        setRows(null)
        return
      }
      const data = (await res.json()) as { proposals?: ProposalView[] }
      setRows(data.proposals ?? [])
    } catch {
      setRows(null)
    }
  }, [base, recordingId])

  useEffect(() => {
    void load()
  }, [load])

  if (rows === null) return null
  if (rows.length === 0 && !showEmpty) return null

  async function decide(p: ProposalView, action: 'apply' | 'dismiss', extra: { edits?: Record<string, unknown>; force?: boolean } = {}) {
    setBusy(p.id)
    setError('')
    setNotice('')
    try {
      const res = await fetch(`${base}/${encodeURIComponent(p.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (res.status === 409 && data.code === 'conflict') {
        setConfirmForce((s) => new Set(s).add(p.id))
        setError(t('conflict'))
      } else if (!res.ok) {
        setError(data.code === 'needs-lead' ? t('pickLeadFirst') : data.error || t('genericError'))
      } else {
        setEditing(null)
        await load()
        if (action === 'apply') onApplied?.()
      }
    } catch {
      setError(t('genericError'))
    } finally {
      setBusy(null)
    }
  }

  async function applyAll() {
    setBusy('all')
    setError('')
    setNotice('')
    try {
      const res = await fetch(`${base}/apply-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordingId ? { recordingId } : {}),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; applied?: number; skipped?: unknown[] }
      if (!res.ok) setError(data.error || t('genericError'))
      else {
        setNotice(t('appliedAll', { applied: data.applied ?? 0, skipped: data.skipped?.length ?? 0 }))
        await load()
        if ((data.applied ?? 0) > 0) onApplied?.()
      }
    } catch {
      setError(t('genericError'))
    } finally {
      setBusy(null)
    }
  }

  function startEdit(p: ProposalView) {
    const to = (f: keyof ProposalView['changes']) => show(p.changes[f]?.to)
    setEditing(p.id)
    const init: EditFields = { label: to('label') || p.taskLabel, stage: to('stage'), priority: to('priority'), due: to('due'), leadName: to('leadName') || (p.leadName ?? '') }
    setEdit({ ...init, orig: init })
  }

  // Only what the approver actually changed is sent; everything else stays as proposed.
  function editsOf(p: ProposalView, e: Edit): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (p.kind === 'CREATE' && e.label !== e.orig.label) out.label = e.label
    if (p.kind !== 'DONE' && p.kind !== 'RETIRE') {
      if (e.stage !== e.orig.stage && e.stage.trim()) out.stage = e.stage
      if (e.priority !== e.orig.priority) out.priority = e.priority.trim() || null
      if (e.due !== e.orig.due) out.due = e.due.trim() || null
      if (e.leadName !== e.orig.leadName) out.leadName = e.leadName.trim() || null
    }
    return out
  }

  const fieldLabel = (f: string) => (['stage', 'priority', 'due', 'leadName', 'label'].includes(f) ? t(`fields.${f}`) : f)
  const pending = rows.filter((r) => r.status === 'PENDING')
  const headline = (p: ProposalView) =>
    p.kind === 'CREATE' ? t('newTask', { label: p.taskLabel }) : p.kind === 'DONE' ? t('markDone', { label: p.taskLabel }) : p.kind === 'RETIRE' ? t('retire', { label: p.taskLabel }) : p.taskLabel

  return (
    <div style={card()} id="call-updates" data-testid="crew-call-updates">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{t('title')}</h2>
        {pending.length > 1 && (
          <button type="button" style={{ ...btn('accent', busy !== null), ...small }} disabled={busy !== null} onClick={applyAll}>
            {busy === 'all' ? t('working') : t('applyAll', { count: pending.length })}
          </button>
        )}
      </div>
      <p style={{ ...muted, margin: '4px 0 12px' }}>{t('intro')}</p>
      {error && (
        <p role="alert" style={{ color: 'hsl(var(--tomato))', fontSize: 13 }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={muted}>
          {notice}
        </p>
      )}
      {rows.length === 0 && <p style={muted}>{t('empty')}</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        {rows.map((p) => {
          const lines = Object.entries(p.changes).filter(([f]) => f !== 'leadMemberId' && f !== 'archived' && !(p.kind === 'CREATE' && f === 'label'))
          const needsPick = p.candidates.length > 0 && !p.leadMemberId
          const isEditing = editing === p.id && edit
          const forced = confirmForce.has(p.id) || p.taskChanged
          return (
            <li key={p.id} data-testid="call-update" style={{ border: '1px solid hsl(var(--rule-warm) / 0.65)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={badge(p.kind === 'CREATE' ? 'accent' : 'default')}>{t(`kinds.${p.kind}`)}</span>
                <strong style={{ overflowWrap: 'anywhere' }}>{headline(p)}</strong>
                {p.status !== 'PENDING' && <span style={badge()}>{t(`statuses.${p.status}`)}</span>}
              </div>
              {lines.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                  {lines.map(([f, c]) => (
                    <li key={f}>
                      {fieldLabel(f)}: {show(c.from) || t('none')} {'→'} <strong>{show(c.to) || t('none')}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {p.kind === 'RETIRE' && <p style={{ ...muted, margin: 0 }}>{t('retireHint')}</p>}
              <p style={{ margin: 0, fontSize: 14 }}>{p.reason}</p>
              {p.quote && (
                <p style={{ ...muted, margin: 0, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                  {p.startMs !== null ? `[${clock(p.startMs)}] ` : ''}
                  {p.quote}
                </p>
              )}
              {p.taskGone && <p style={{ color: 'hsl(var(--tomato))', fontSize: 13, margin: 0 }}>{t('taskGone')}</p>}
              {p.taskChanged && !p.taskGone && <p style={{ color: 'hsl(var(--tomato))', fontSize: 13, margin: 0 }}>{t('taskChanged')}</p>}
              {needsPick && p.status === 'PENDING' && (
                <label style={field}>
                  {t('pickLead', { name: p.leadName ?? '' })}
                  <select
                    style={input()}
                    value={picked[p.id] ?? ''}
                    onChange={(e) => setPicked((s) => ({ ...s, [p.id]: e.target.value }))}
                  >
                    <option value="">{t('chooseMember')}</option>
                    {p.candidates.map((c) => (
                      <option key={c.memberId} value={c.memberId}>
                        {c.name}
                      </option>
                    ))}
                    <option value="__skip">{t('skipLead')}</option>
                  </select>
                </label>
              )}
              {isEditing && (
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                  {p.kind === 'CREATE' && (
                    <label style={{ ...field, gridColumn: '1 / -1' }}>
                      {t('fields.label')}
                      <input style={input()} value={edit.label} maxLength={300} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
                    </label>
                  )}
                  {p.kind !== 'DONE' && p.kind !== 'RETIRE' && (
                    <>
                      <label style={field}>
                        {t('fields.stage')}
                        <input style={input()} value={edit.stage} maxLength={40} onChange={(e) => setEdit({ ...edit, stage: e.target.value })} />
                      </label>
                      <label style={field}>
                        {t('fields.priority')}
                        <input style={input()} value={edit.priority} maxLength={40} onChange={(e) => setEdit({ ...edit, priority: e.target.value })} />
                      </label>
                      <label style={field}>
                        {t('fields.due')}
                        <input style={input()} value={edit.due} placeholder="YYYY-MM-DD" maxLength={10} onChange={(e) => setEdit({ ...edit, due: e.target.value })} />
                      </label>
                      <label style={field}>
                        {t('fields.leadName')}
                        <input style={input()} value={edit.leadName} maxLength={120} onChange={(e) => setEdit({ ...edit, leadName: e.target.value })} />
                      </label>
                    </>
                  )}
                </div>
              )}
              {p.status === 'PENDING' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    style={{ ...btn('accent', busy !== null || p.taskGone), ...small }}
                    disabled={busy !== null || p.taskGone}
                    onClick={() => {
                      const pick = picked[p.id]
                      const e: Record<string, unknown> = isEditing && edit ? editsOf(p, edit) : {}
                      if (pick === '__skip') e.skipLead = true
                      else if (pick) {
                        e.leadMemberId = pick
                        e.leadName = p.candidates.find((c) => c.memberId === pick)?.name ?? null
                      }
                      void decide(p, 'apply', { edits: e, force: forced })
                    }}
                  >
                    {busy === p.id ? t('working') : forced ? t('applyAnyway') : t('apply')}
                  </button>
                  {editing === p.id ? (
                    <button type="button" style={{ ...btn('secondary'), ...small }} onClick={() => setEditing(null)}>
                      {t('cancelEdit')}
                    </button>
                  ) : (
                    p.kind !== 'DONE' && p.kind !== 'RETIRE' && (
                      <button type="button" style={{ ...btn('secondary'), ...small }} disabled={busy !== null} onClick={() => startEdit(p)}>
                        {t('edit')}
                      </button>
                    )
                  )}
                  <button type="button" style={{ ...btn('secondary'), ...small }} disabled={busy !== null} onClick={() => void decide(p, 'dismiss')}>
                    {t('dismiss')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
