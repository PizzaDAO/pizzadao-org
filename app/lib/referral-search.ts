/**
 * Member search for the "Who invited you?" onboarding step (L3.1). Pure.
 */
import type { PublicMember } from './sheets/members-list'

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

/** Pure: rank members for a query (exact ID, then name prefix, then word prefix, then substring). */
export function searchInviters(members: PublicMember[], rawQuery: string, limit = 8) {
  const q = fold(rawQuery).replace(/^#/, '')
  if (q.length < 2 && !/^\d+$/.test(q)) return []
  const scored: Array<{ m: PublicMember; score: number }> = []
  for (const m of members) {
    const name = fold(m.name)
    let score = 0
    if (m.id === q) score = 100
    else if (name.startsWith(q)) score = 50
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 30
    else if (name.includes(q)) score = 10
    if (score) scored.push({ m, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name))
    .slice(0, limit)
    .map(({ m }) => ({ memberId: m.id, name: m.name, city: m.city || null }))
}
