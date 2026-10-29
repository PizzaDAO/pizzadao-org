// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { MISSION_VERIFIER_CONFIG, planGuideLinks, type GuideLinkRow } from './mission-config'
import { parseGuideHref } from '@/app/lib/guide-href'
import { HANDBOOK_LOADERS, handbookPageDef, isHandbookSlug, type HandbookSlug } from '@/content/handbook'
import { extractAnchors } from '@/app/lib/handbook'

const seeded = MISSION_VERIFIER_CONFIG.filter((c) => c.guideHref)

describe('seeded mission guide links', () => {
  it('links the planned missions', () => {
    expect(seeded.length).toBeGreaterThanOrEqual(10)
  })

  it('every seeded link is a valid internal path the admin editor would accept', () => {
    for (const c of seeded) expect(parseGuideHref(c.guideHref), `L${c.level}.${c.index}`).toEqual({ ok: true, value: c.guideHref })
  })

  it('every seeded handbook link points at a real page and a real English anchor (renaming one breaks the build, not the link)', async () => {
    for (const c of seeded) {
      const m = /^\/handbook\/([a-z0-9-]+)(?:#([a-z0-9-]+))?$/.exec(c.guideHref!)
      if (!m) continue // calls/how-to-attend etc. are plain routes
      const [, slug, anchor] = m
      expect(isHandbookSlug(slug), `L${c.level}.${c.index}: no handbook page ${slug}`).toBe(true)
      if (!anchor) continue
      const en = await HANDBOOK_LOADERS[slug as HandbookSlug].en()
      const anchors = new Set([...extractAnchors(en.body), ...(handbookPageDef(slug as HandbookSlug).dynamicAnchors ?? [])])
      expect(anchors.has(anchor), `L${c.level}.${c.index}: ${c.guideHref}`).toBe(true)
    }
  })
})

describe('planGuideLinks', () => {
  const rows = (guideHref: string | null = null): GuideLinkRow[] =>
    MISSION_VERIFIER_CONFIG.map((c, i) => ({ id: i + 1, level: c.level, index: c.index, guideHref }))

  it('fills NULLs only and is idempotent', () => {
    const plan = planGuideLinks(rows())
    expect(plan.updates).toHaveLength(seeded.length)
    expect(plan.kept).toEqual([])
    const after = rows().map((r) => ({ ...r, guideHref: plan.updates.find((u) => u.id === r.id)?.guideHref ?? null }))
    expect(planGuideLinks(after).updates).toEqual([])
  })

  it('never touches a row that already has a link (an admin edit is kept)', () => {
    const r = rows()
    r[0] = { ...r[0], guideHref: '/handbook/levels' }
    const plan = planGuideLinks(r)
    expect(plan.updates.find((u) => u.id === r[0].id)).toBeUndefined()
    expect(plan.kept).toContain('L1.1')
  })

  it('skips a mission whose link an admin ever edited (it may have been cleared on purpose)', () => {
    const r = rows()
    const plan = planGuideLinks(r, MISSION_VERIFIER_CONFIG, new Set([r[0].id]))
    expect(plan.updates.find((u) => u.id === r[0].id)).toBeUndefined()
    expect(plan.kept).toContain('L1.1')
  })

  it('reports a config entry with no row', () => {
    const plan = planGuideLinks(rows().slice(1))
    expect(plan.missing.length).toBeGreaterThan(0)
  })
})
