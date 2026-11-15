import { describe, it, expect } from 'vitest'
import { isFactKey, placeholdersIn } from '@/app/lib/handbook'
import { isHandbookSlug } from '@/content/handbook'
import { extractAnchors } from '@/app/lib/handbook'
import { SEED_LANES, planLaneSeed } from './seed-data'
import { parseStepLink, STEP_BODY_MAX, STEP_LABEL_MAX, STEP_TITLE_MAX, isLaneSlug } from './links'
import { SUMMARY_MAX, TAG_MAX, TITLE_MAX } from './admin'

describe('seed lanes', () => {
  it('the six tracks, in order, each ending at the mission submit step', () => {
    expect(SEED_LANES.map((l) => l.slug)).toEqual(['host', 'build', 'create', 'gather', 'experiment', 'grow'])
    expect(SEED_LANES.map((l) => l.position)).toEqual([1, 2, 3, 4, 5, 6])
    for (const l of SEED_LANES) expect(l.steps[l.steps.length - 1].kind, l.slug).toBe('submit')
  })

  it('everything fits what the admin editor accepts', () => {
    for (const l of SEED_LANES) {
      expect(isLaneSlug(l.slug)).toBe(true)
      expect(l.tag.length).toBeLessThanOrEqual(TAG_MAX)
      expect(l.title.length).toBeLessThanOrEqual(TITLE_MAX)
      expect(l.summary.length).toBeLessThanOrEqual(SUMMARY_MAX)
      for (const s of l.steps) {
        expect(s.title.length).toBeLessThanOrEqual(STEP_TITLE_MAX)
        expect(s.body.length).toBeLessThanOrEqual(STEP_BODY_MAX)
        expect((s.linkLabel ?? '').length).toBeLessThanOrEqual(STEP_LABEL_MAX)
        expect(parseStepLink(s.linkHref), `${l.slug}: ${s.title}`).toMatchObject({ ok: true })
        for (const p of placeholdersIn(s.body)) expect(isFactKey(p), `${l.slug}: {{${p}}}`).toBe(true)
      }
    }
  })

  it('handbook links point at pages and anchors that exist', async () => {
    for (const l of SEED_LANES)
      for (const s of l.steps) {
        const m = s.linkHref?.match(/^\/handbook\/([a-z0-9-]+)(?:#([a-z0-9-]+))?$/)
        if (!m) continue
        expect(isHandbookSlug(m[1]), `${l.slug}: ${s.linkHref}`).toBe(true)
        if (m[2]) {
          const mod = await import(`@/content/handbook/${m[1]}/en`)
          expect(extractAnchors(mod.body), `${l.slug}: ${s.linkHref}`).toContain(m[2])
        }
      }
  })

  it('keeps the repo text generic: no ids or personal links', () => {
    const all = JSON.stringify(SEED_LANES)
    expect(all).not.toMatch(/\d{15,}/)
    expect(all).not.toMatch(/@[a-z0-9_.-]+\.[a-z]{2,}/i)
  })
})

describe('planLaneSeed', () => {
  const missions = [
    { id: 22, title: 'Host a Global Pizza Party' },
    { id: 29, title: 'Bounty hunter' },
    { id: 40, title: ' throw a PIZZA party ' },
  ]
  it('resolves missions by exact title ignoring case, reports missing ones, leaves guide-only lanes', () => {
    const plan = planLaneSeed([], missions)
    const host = plan.create.find((c) => c.lane.slug === 'host')!
    expect(host.missionId).toBe(40)
    expect(host.stretchMissionIds).toEqual([22])
    expect(plan.create.find((c) => c.lane.slug === 'build')!.missionId).toBe(29)
    expect(plan.create.find((c) => c.lane.slug === 'gather')!.missionId).toBeNull()
    expect(plan.missingMissions).toContain('Hold the room')
    expect(plan.missingMissions).not.toContain('Bounty hunter')
  })
  it('never touches a lane that already exists, and a second run does nothing', () => {
    const plan = planLaneSeed(SEED_LANES.map((l) => l.slug), missions)
    expect(plan.create).toEqual([])
    expect(plan.kept).toHaveLength(6)
    expect(planLaneSeed(['host'], missions).create.map((c) => c.lane.slug)).not.toContain('host')
  })
})
