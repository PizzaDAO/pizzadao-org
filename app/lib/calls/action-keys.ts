/**
 * A stable key per stored action item (CallRecording.actionItems[].key), so a follow-up can point
 * at the item it is about even when a reviewer edits the list. The server is the only authority: a
 * key sent by a client is kept only when the previous list had it, so a forged key never links
 * anything (see plans/recap-action-status.md).
 */
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'

export const ACTION_KEY_RE = /^[a-z0-9]{6,12}$/
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function newActionKey(): string {
  let k = ''
  for (let i = 0; i < 8; i++) k += ALPHABET[randomInt(ALPHABET.length)]
  return k
}

/** Same normalization as carryDone: case and whitespace insensitive. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const tokens = (s: string) => new Set(norm(s).replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(' ').filter(Boolean))

/** Token Jaccard similarity of two texts (0..1). */
export function textSimilarity(a: string, b: string): number {
  const x = tokens(a)
  const y = tokens(b)
  if (!x.size || !y.size) return 0
  let both = 0
  for (const t of x) if (y.has(t)) both++
  return both / (x.size + y.size - both)
}

interface Keyed { text?: unknown; owner?: unknown; key?: unknown }
const asList = (v: unknown): Keyed[] => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? (x as Keyed) : {})) : [])
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const validKey = (v: unknown): v is string => typeof v === 'string' && ACTION_KEY_RE.test(v)

/**
 * Give every item of `next` a key. In order: its own key when the previous list had it and nobody
 * used it yet; the key of an unused previous item with the same text; the key of the unused
 * previous item at the same position with the same owner and a similar text (a light rewording);
 * else a new key.
 */
export function assignActionKeys<T extends { text: string; owner?: string | null }>(prev: unknown, next: T[]): Array<T & { key: string }> {
  const before = asList(prev)
  const prevKeys = new Set(before.map((p) => p.key).filter(validKey))
  const used = new Set<string>()
  const taken = (k: string) => used.has(k)
  const out: Array<string | null> = next.map((n) => {
    const own = (n as { key?: unknown }).key
    if (validKey(own) && prevKeys.has(own) && !taken(own)) {
      used.add(own)
      return own
    }
    return null
  })
  const free = (i: number) => validKey(before[i]?.key) && !taken(before[i].key as string)
  next.forEach((n, i) => {
    if (out[i]) return
    const j = before.findIndex((p, pi) => free(pi) && norm(str(p.text)) === norm(n.text))
    if (j >= 0) {
      used.add(before[j].key as string)
      out[i] = before[j].key as string
    }
  })
  next.forEach((n, i) => {
    if (out[i]) return
    const p = before[i]
    if (p && free(i) && norm(str(p.owner)) === norm(n.owner ?? '') && textSimilarity(str(p.text), n.text) >= 0.5) {
      used.add(p.key as string)
      out[i] = p.key as string
    }
  })
  return next.map((n, i) => {
    let k = out[i]
    if (!k) {
      do k = newActionKey()
      while (used.has(k) || prevKeys.has(k))
      used.add(k)
    }
    return { ...n, key: k }
  })
}

/** Keeps valid, unique keys already on the items and gives the rest a new one. Returns the same list when nothing was missing. */
export function fillMissingKeys<T extends object>(items: T[]): { items: Array<T & { key: string }>; changed: boolean } {
  const seen = new Set<string>()
  let changed = false
  const out = items.map((it) => {
    const own = (it as { key?: unknown }).key
    if (validKey(own) && !seen.has(own)) {
      seen.add(own)
      return it as T & { key: string }
    }
    let k: string
    do k = newActionKey()
    while (seen.has(k))
    seen.add(k)
    changed = true
    return { ...it, key: k }
  })
  return { items: out, changed }
}

/**
 * Make sure every stored action item of a call has a key (calls summarized before keys existed).
 * Read, assign and write under a per-call lock (reviewer saves take the same lock) with a write guarded by updatedAt, so two runs cannot hand out different keys and a concurrent save is never overwritten.
 * Returns the items, or [] when the call or its list is missing.
 */
export async function ensureActionKeys(recordingId: string): Promise<Array<{ key: string; text: string; owner?: string }>> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'action-keys:' + recordingId}))`
    const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
    // The write only lands when nobody saved the call since we read it (updatedAt); otherwise read again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const rec = await tx.callRecording.findUnique({ where: { id: recordingId }, select: { actionItems: true, updatedAt: true } })
      if (!rec || !Array.isArray(rec.actionItems)) return []
      const { items, changed } = fillMissingKeys((rec.actionItems as unknown[]).filter(isObj))
      if (changed) {
        // Entries that are not objects (never written by the app) stay where they are.
        let n = 0
        const all = (rec.actionItems as unknown[]).map((x) => (isObj(x) ? items[n++] : x))
        const res = await tx.callRecording.updateMany({ where: { id: recordingId, updatedAt: rec.updatedAt }, data: { actionItems: all as unknown as Prisma.InputJsonValue } })
        if (res.count !== 1) continue
      }
      return items.map((i) => ({ key: i.key, text: str(i.text), ...(typeof i.owner === 'string' && i.owner ? { owner: i.owner } : {}) }))
    }
    return []
  })
}
