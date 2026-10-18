'use client'

// jalapeno-82565 — Custom Crew Bounties v2: a crew runs its bounties from
// /crew/[crewId]. Post (reward escrowed from the poster's wallet), claim,
// submit work, then the poster or a crew lead approves (pays the claimer) or
// sends it back with a note.
//
// Button visibility here is advisory only: every write route re-checks
// permissions on the server (poster / crew lead / admin; never the claimer
// approving their own work).

import Link from 'next/link'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { badge, btn, card, input } from '@/app/ui/shared-styles'
import { DiscordText } from '@/app/ui/shared/DiscordText'

export type CrewBounty = {
  id: number
  description: string
  link: string | null
  reward: number
  status: 'OPEN' | 'CLAIMED' | 'SUBMITTED'
  crewId?: string | null
  createdBy?: string
  claimedBy?: string | null
  submissionNote?: string | null
  submissionLink?: string | null
  reviewNote?: string | null
}

type Viewer = { discordId: string; canManageCrew: boolean }

/** Only OPEN bounties tagged with this crew, highest reward first. */
export function openCrewBounties(bounties: CrewBounty[], crewId: string): CrewBounty[] {
  return bounties
    .filter((b) => b.status === 'OPEN' && b.crewId === crewId)
    .sort((a, b) => b.reward - a.reward)
}

/** This crew's bounties split into Open, In progress (CLAIMED) and Awaiting review (SUBMITTED). */
export function groupCrewBounties(bounties: CrewBounty[], crewId: string) {
  const mine = bounties.filter((b) => b.crewId === crewId)
  const byReward = (a: CrewBounty, b: CrewBounty) => b.reward - a.reward
  return {
    open: mine.filter((b) => b.status === 'OPEN').sort(byReward),
    inProgress: mine.filter((b) => b.status === 'CLAIMED').sort(byReward),
    review: mine.filter((b) => b.status === 'SUBMITTED').sort(byReward),
  }
}

const safeHttps = (url?: string | null) => (url && /^https:\/\//i.test(url) ? url : undefined)

const small: CSSProperties = { padding: '6px 12px', fontSize: 13 }
const danger: CSSProperties = { color: 'hsl(var(--tomato))', borderColor: 'hsl(var(--tomato) / 0.40)' }
const label: CSSProperties = { display: 'grid', gap: 4, fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))' }

type OpenForm = { id: number; kind: 'submit' | 'reject' } | null

export function CrewBounties({
  crewId,
  crewLabel,
  hideWhenEmpty = false,
  viewerDiscordId,
}: {
  crewId: string
  crewLabel: string
  hideWhenEmpty?: boolean
  /** Fallback viewer id from the page's own session lookup; the API's `viewer` wins. */
  viewerDiscordId?: string
}) {
  const t = useTranslations('crewBounties')
  const locale = useLocale()
  const fmt = (n: number) => new Intl.NumberFormat(locale).format(n)

  // Plain fetch (like the page's manuals fetch) so the crew page doesn't
  // need a react-query provider in tests.
  const [bounties, setBounties] = useState<CrewBounty[] | null>(null)
  const [channels, setChannels] = useState<Record<string, string>>({})
  const [roles, setRoles] = useState<Record<string, string>>({})
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [balance, setBalance] = useState<number | null>(null)
  const [showPost, setShowPost] = useState(false)
  const [desc, setDesc] = useState('')
  const [reward, setReward] = useState('')
  const [link, setLink] = useState('')
  const [posting, setPosting] = useState(false)

  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<{ id: number | 'post'; message: string } | null>(null)
  const [form, setForm] = useState<OpenForm>(null)
  const [note, setNote] = useState('')
  const [proof, setProof] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let list: CrewBounty[] = []
      let resolvedChannels: Record<string, string> = {}
      let resolvedRoles: Record<string, string> = {}
      let resolvedViewer: Viewer | null = null
      try {
        const res = await fetch(`/api/bounties?crewId=${encodeURIComponent(crewId)}`, { cache: 'no-store' })
        if (res?.ok) {
          const json = (await res.json()) as {
            bounties?: CrewBounty[]
            channels?: Record<string, string>
            roles?: Record<string, string>
            viewer?: Viewer
          }
          const all = Array.isArray(json?.bounties) ? json.bounties : []
          list = all.filter((b) => b.crewId === crewId)
          resolvedChannels = json?.channels ?? {}
          resolvedRoles = json?.roles ?? {}
          resolvedViewer = json?.viewer ?? null
        }
      } catch {
        // Non-critical section: fall through to the empty state.
      }
      if (!cancelled) {
        setBounties(list)
        setChannels(resolvedChannels)
        setRoles(resolvedRoles)
        setViewer(resolvedViewer)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [crewId, reloadKey])

  const viewerId = viewer?.discordId ?? viewerDiscordId
  const signedIn = !!viewerId

  // Wallet balance for the post form (only once the form is opened).
  useEffect(() => {
    if (!showPost || !signedIn) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/economy/balance', { cache: 'no-store' })
        if (res?.ok) {
          const json = (await res.json()) as { balance?: number }
          if (!cancelled && typeof json.balance === 'number') setBalance(json.balance)
        }
      } catch {
        // Balance is a convenience; the server enforces funds.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showPost, signedIn, reloadKey])

  const call = useCallback(
    async (path: string, body: Record<string, unknown>, id: number | 'post'): Promise<boolean> => {
      setError(null)
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError({ id, message: typeof data?.error === 'string' && data.error ? data.error : t('error') })
          return false
        }
        return true
      } catch {
        setError({ id, message: t('error') })
        return false
      }
    },
    [t],
  )

  const act = async (b: CrewBounty, action: 'claim' | 'giveup' | 'complete' | 'cancel', confirmKey?: string) => {
    if (confirmKey && typeof window !== 'undefined' && !window.confirm(t(confirmKey, { reward: fmt(b.reward) }))) return
    setBusyId(b.id)
    const ok = await call(`/api/bounties/${action}`, { bountyId: b.id }, b.id)
    setBusyId(null)
    if (ok) setReloadKey((k) => k + 1)
  }

  const sendForm = async (b: CrewBounty) => {
    if (!form) return
    setBusyId(b.id)
    const ok =
      form.kind === 'submit'
        ? await call('/api/bounties/submit', { bountyId: b.id, note, ...(proof.trim() ? { link: proof.trim() } : {}) }, b.id)
        : await call('/api/bounties/reject', { bountyId: b.id, note }, b.id)
    setBusyId(null)
    if (ok) {
      setForm(null)
      setNote('')
      setProof('')
      setReloadKey((k) => k + 1)
    }
  }

  const openForm = (id: number, kind: 'submit' | 'reject') => {
    setForm({ id, kind })
    setNote('')
    setProof('')
    setError(null)
  }

  const post = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(reward)
    setPosting(true)
    const ok = await call(
      '/api/bounties',
      { description: desc, reward: amount, crewId, ...(link.trim() ? { link: link.trim() } : {}) },
      'post',
    )
    setPosting(false)
    if (ok) {
      setDesc('')
      setReward('')
      setLink('')
      setShowPost(false)
      setReloadKey((k) => k + 1)
    }
  }

  if (bounties === null) return null
  const groups = groupCrewBounties(bounties, crewId)
  const total = groups.open.length + groups.inProgress.length + groups.review.length
  if (hideWhenEmpty && total === 0 && !signedIn) return null

  const renderRow = (b: CrewBounty) => {
    const isPoster = !!viewerId && b.createdBy === viewerId
    const isClaimer = !!viewerId && b.claimedBy === viewerId
    const canManage = !!viewerId && (isPoster || !!viewer?.canManageCrew)
    const busy = busyId === b.id
    const proofUrl = safeHttps(b.submissionLink)

    return (
      <li
        key={b.id}
        data-testid={`crew-bounty-${b.id}`}
        style={{
          display: 'grid',
          gap: 10,
          padding: 12,
          borderRadius: 'var(--radius)',
          border: '1px solid hsl(var(--rule) / 0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'hsl(var(--foreground))', overflowWrap: 'anywhere' }}>
              <DiscordText text={b.description} channels={channels} roles={roles} interactive={false} />
            </div>
            {b.link && (
              <div style={{ marginTop: 4 }}>
                <a
                  href={b.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'hsl(var(--tomato))', wordBreak: 'break-all' }}
                >
                  {b.link}
                </a>
              </div>
            )}
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {isPoster && <span style={badge()}>{t('yourBounty')}</span>}
              {isClaimer && b.status !== 'OPEN' && (
                <span style={badge()}>
                  {t('claimedBy')} {t('you')}
                </span>
              )}
            </div>
          </div>
          <span style={{ ...badge('accent'), whiteSpace: 'nowrap' }}>{t('reward', { reward: fmt(b.reward) })}</span>
        </div>

        {b.status === 'SUBMITTED' && (b.submissionNote || proofUrl) && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              background: 'hsl(var(--butter) / 0.15)',
              border: '1px solid hsl(var(--butter) / 0.40)',
              fontSize: 13,
              display: 'grid',
              gap: 4,
            }}
          >
            <strong>{t('submission')}</strong>
            {b.submissionNote && <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{b.submissionNote}</span>}
            {proofUrl && (
              <a href={proofUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'hsl(var(--tomato))', wordBreak: 'break-all' }}>
                {t('viewProof')}
              </a>
            )}
          </div>
        )}

        {b.status === 'CLAIMED' && b.reviewNote && (
          <div
            data-testid="crew-bounty-review-note"
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius)',
              background: 'hsl(var(--tomato) / 0.06)',
              border: '1px solid hsl(var(--tomato) / 0.30)',
              fontSize: 13,
              color: 'hsl(var(--tomato))',
              overflowWrap: 'anywhere',
            }}
          >
            {t('sentBack', { note: b.reviewNote })}
          </div>
        )}

        {signedIn && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {b.status === 'OPEN' && !isPoster && (
              <button type="button" disabled={busy} style={{ ...btn('accent', busy), ...small }} onClick={() => act(b, 'claim')}>
                {busy ? t('working') : t('claim')}
              </button>
            )}
            {b.status === 'CLAIMED' && isClaimer && (
              <button type="button" disabled={busy} style={{ ...btn('accent', busy), ...small }} onClick={() => openForm(b.id, 'submit')}>
                {t('submitWork')}
              </button>
            )}
            {(b.status === 'CLAIMED' || b.status === 'SUBMITTED') && isClaimer && (
              <button
                type="button"
                disabled={busy}
                style={{ ...btn('secondary', busy), ...small }}
                onClick={() => act(b, 'giveup', 'confirmGiveUp')}
              >
                {t('giveUp')}
              </button>
            )}
            {b.status === 'SUBMITTED' && canManage && !isClaimer && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  style={{ ...btn('accent', busy), ...small }}
                  onClick={() => act(b, 'complete', 'confirmApprove')}
                >
                  {busy ? t('working') : t('approve')}
                </button>
                <button type="button" disabled={busy} style={{ ...btn('secondary', busy), ...small }} onClick={() => openForm(b.id, 'reject')}>
                  {t('reject')}
                </button>
              </>
            )}
            {canManage && !isClaimer && (
              <button
                type="button"
                disabled={busy}
                style={{ ...btn('secondary', busy), ...small, ...danger }}
                onClick={() => act(b, 'cancel', 'confirmCancel')}
              >
                {t('cancel')}
              </button>
            )}
          </div>
        )}

        {form?.id === b.id && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void sendForm(b)
            }}
            style={{ display: 'grid', gap: 8 }}
          >
            <label style={label}>
              {form.kind === 'submit' ? t('submitNoteLabel') : t('rejectNoteLabel')}
              <textarea
                required
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ ...input(), minHeight: 72, resize: 'vertical' }}
              />
            </label>
            {form.kind === 'submit' && (
              <label style={label}>
                {t('submitLinkLabel')}
                <input type="url" value={proof} onChange={(e) => setProof(e.target.value)} style={input()} />
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" disabled={busy || !note.trim()} style={{ ...btn('accent', busy || !note.trim()), ...small }}>
                {busy ? t('working') : form.kind === 'submit' ? t('submitSend') : t('rejectSend')}
              </button>
              <button type="button" style={{ ...btn('secondary', false), ...small }} onClick={() => setForm(null)}>
                {t('formDismiss')}
              </button>
            </div>
          </form>
        )}

        {error?.id === b.id && (
          <div role="alert" style={{ fontSize: 12, color: 'hsl(var(--tomato))' }}>
            {error.message}
          </div>
        )}
      </li>
    )
  }

  const section = (key: 'sectionOpen' | 'sectionInProgress' | 'sectionReview', list: CrewBounty[]) =>
    list.length > 0 && (
      <section aria-label={t(key, { count: list.length })} style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>{t(key, { count: list.length })}</h3>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>{list.map(renderRow)}</ul>
      </section>
    )

  return (
    <div id="bounties" style={card()} data-testid="crew-bounties">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          paddingBottom: 12,
          borderBottom: '1px solid hsl(var(--rule) / 0.12)',
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            margin: 0,
            fontFamily: 'var(--font-display), var(--font-sans), system-ui, sans-serif',
            letterSpacing: '-0.01em',
            color: 'hsl(var(--foreground))',
          }}
        >
          {t('title', { count: total })}
        </h2>
        {signedIn ? (
          <button
            type="button"
            aria-expanded={showPost}
            onClick={() => setShowPost((v) => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, minHeight: 44, fontSize: 13, fontWeight: 600, color: 'hsl(var(--tomato))' }}
          >
            {showPost ? t('formClose') : `+ ${t('postToggle', { crew: crewLabel })}`}
          </button>
        ) : (
          <Link href={`/login?returnTo=${encodeURIComponent(`/crew/${crewId}`)}`} style={{ fontSize: 13, fontWeight: 600, color: 'hsl(var(--tomato))', textDecoration: 'none' }}>
            {t('login')}
          </Link>
        )}
      </div>

      {signedIn && showPost && (
        <form onSubmit={post} style={{ display: 'grid', gap: 10 }} data-testid="crew-bounty-post-form">
          <label style={label}>
            {t('descriptionLabel')}
            <textarea
              required
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              style={{ ...input(), minHeight: 72, resize: 'vertical' }}
            />
          </label>
          <label style={label}>
            {t('rewardLabel')}
            <input
              required
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              style={input()}
            />
          </label>
          <label style={label}>
            {t('linkLabel')}
            <input type="url" value={link} onChange={(e) => setLink(e.target.value)} style={input()} />
          </label>
          {balance !== null && <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>{t('balance', { balance: `${fmt(balance)} PEP` })}</div>}
          <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}>{t('escrowNote')}</div>
          <div>
            <button type="submit" disabled={posting} style={{ ...btn('accent', posting), ...small }}>
              {posting ? t('posting') : t('post')}
            </button>
          </div>
          {error?.id === 'post' && (
            <div role="alert" style={{ fontSize: 12, color: 'hsl(var(--tomato))' }}>
              {error.message}
            </div>
          )}
        </form>
      )}

      {total === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: 'hsl(var(--muted-foreground))' }}>{t('empty')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {section('sectionReview', groups.review)}
          {section('sectionOpen', groups.open)}
          {section('sectionInProgress', groups.inProgress)}
        </div>
      )}
    </div>
  )
}
