'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Vote = 'YES' | 'NO'
type Candidate = {
  id: string
  imageUrl: string
  traits: Record<string, string>
  position: number
  yes: number
  no: number
  mine: { vote: Vote; comment: string | null } | null
  comments: Array<{ name: string; vote: Vote; comment: string; mine: boolean }>
}
type SetView = {
  slug: string
  title: string
  description: string | null
  candidates: Candidate[]
  setComments: Array<{ name: string; comment: string; mine: boolean }>
  myComment: string
}

export default function ReviewClient({ slug, isOwner }: { slug: string; isOwner: boolean }) {
  const [data, setData] = useState<SetView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Candidate | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [overall, setOverall] = useState('')
  const overallDirty = useRef(false)
  const [overallBusy, setOverallBusy] = useState(false)
  const dirty = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/image-review/${slug}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(res.status === 404 ? 'No such review set' : 'Could not load')
      const next = (await res.json()) as SetView
      setData(next)
      setError(null)
      if (!overallDirty.current) setOverall(next.myComment)
      // Seed comment boxes from my saved comment, but never overwrite one I am typing in.
      setDrafts((d) => {
        const out = { ...d }
        for (const c of next.candidates) if (!dirty.current.has(c.id)) out[c.id] = c.mine?.comment ?? ''
        return out
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }, [slug])

  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load])

  async function vote(c: Candidate, v: Vote) {
    setBusy(c.id)
    try {
      const res = await fetch(`/api/image-review/${slug}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: c.id, vote: v, comment: drafts[c.id] ?? '' }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string }
        setError(b.error ?? 'Could not save your vote')
      } else {
        dirty.current.delete(c.id)
        await load()
      }
    } finally {
      setBusy(null)
    }
  }

  async function saveOverall() {
    setOverallBusy(true)
    try {
      const res = await fetch(`/api/image-review/${slug}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: overall }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string }
        setError(b.error ?? 'Could not save your feedback')
      } else {
        overallDirty.current = false
        await load()
      }
    } finally {
      setOverallBusy(false)
    }
  }

  if (error && !data) return <main className="p-6 text-center">{error}</main>
  if (!data) return <main className="p-6 text-center text-foreground/60">Loading...</main>

  const done = data.candidates.filter((c) => c.mine).length

  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold">{data.title}</h1>
      {data.description && <p className="text-foreground/70 mt-1">{data.description}</p>}
      <p className="text-sm text-foreground/60 mt-2">
        You have voted on {done} of {data.candidates.length}. Vote Yes if it fits, No if not; you can change it any time.
        {isOwner && (
          <>
            {' '}
            <a className="underline" href={`/api/image-review/${slug}/export`}>Export CSV</a>
            {' · '}
            <a className="underline" href={`/api/image-review/${slug}/export?format=json`}>JSON</a>
          </>
        )}
      </p>
      {error && <p role="alert" className="text-red-600 mt-2 text-sm">{error}</p>}
      <section className="mt-5 rounded-xl border border-foreground/15 p-3 grid gap-2" aria-label="Overall feedback">
        <h2 className="text-base font-semibold m-0">Overall feedback on the set</h2>
        <textarea
          value={overall}
          maxLength={1000}
          rows={3}
          placeholder="What do you think of the set as a whole? (one comment per person, up to 1000 characters)"
          aria-label="Overall feedback on the whole set"
          onChange={(e) => {
            overallDirty.current = true
            setOverall(e.target.value)
          }}
          className="w-full rounded-lg border border-foreground/25 bg-transparent p-2 text-base"
        />
        {overall !== data.myComment && (
          <button type="button" disabled={overallBusy} onClick={() => void saveOverall()} className="self-start min-h-11 px-4 rounded-lg border border-foreground/25 font-medium">
            Save feedback
          </button>
        )}
        {data.setComments.length > 0 && (
          <ul className="text-sm space-y-1">
            {data.setComments.map((m, i) => (
              <li key={i}>
                <span className="font-medium">{m.mine ? 'You' : m.name}</span>: {m.comment}
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.candidates.length === 0 && <p className="mt-6 text-foreground/60">No candidates yet.</p>}
      <div className="grid gap-4 mt-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {data.candidates.map((c) => (
          <section key={c.id} className="rounded-xl border border-foreground/15 p-3 flex flex-col gap-2">
            <button type="button" onClick={() => setZoom(c)} aria-label={`Enlarge candidate ${c.position + 1}`} className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.imageUrl} alt={`Candidate ${c.position + 1}`} loading="lazy" className="w-full aspect-square object-cover rounded-lg bg-foreground/5" />
            </button>
            <div className="text-xs text-foreground/60 flex flex-wrap gap-x-3">
              {Object.entries(c.traits).map(([k, v]) => (
                <span key={k}>{k}: {v}</span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy === c.id}
                aria-pressed={c.mine?.vote === 'YES'}
                onClick={() => void vote(c, 'YES')}
                className={`flex-1 min-h-11 rounded-lg border font-medium ${c.mine?.vote === 'YES' ? 'bg-green-600 text-white border-green-600' : 'border-foreground/25'}`}
              >
                Yes ({c.yes})
              </button>
              <button
                type="button"
                disabled={busy === c.id}
                aria-pressed={c.mine?.vote === 'NO'}
                onClick={() => void vote(c, 'NO')}
                className={`flex-1 min-h-11 rounded-lg border font-medium ${c.mine?.vote === 'NO' ? 'bg-red-600 text-white border-red-600' : 'border-foreground/25'}`}
              >
                No ({c.no})
              </button>
            </div>
            <textarea
              value={drafts[c.id] ?? ''}
              maxLength={500}
              rows={2}
              placeholder="Optional comment (saved with your vote)"
              aria-label={`Comment on candidate ${c.position + 1}`}
              onChange={(e) => {
                dirty.current.add(c.id)
                setDrafts((d) => ({ ...d, [c.id]: e.target.value }))
              }}
              className="w-full rounded-lg border border-foreground/25 bg-transparent p-2 text-base"
            />
            {c.mine && (drafts[c.id] ?? '') !== (c.mine.comment ?? '') && (
              <button type="button" disabled={busy === c.id} onClick={() => void vote(c, c.mine!.vote)} className="self-start text-sm underline">
                Save comment
              </button>
            )}
            {c.comments.length > 0 && (
              <ul className="text-sm space-y-1">
                {c.comments.map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{m.mine ? 'You' : m.name}</span> <span className="text-foreground/50">({m.vote === 'YES' ? 'yes' : 'no'})</span>: {m.comment}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {zoom && (
        <div role="dialog" aria-modal="true" onClick={() => setZoom(null)} className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.imageUrl} alt={`Candidate ${zoom.position + 1}`} className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </main>
  )
}
