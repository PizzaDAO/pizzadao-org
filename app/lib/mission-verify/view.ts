/**
 * One view of "where am I on missions" built from the missions overview plus
 * a verifier run, shared by POST /api/missions/check (JSON) and the
 * /missions Discord command (embed). Pure: no DB, no Discord.
 */
import type { MissionHold } from '@prisma/client'
import { makeEmbed, type Embed, type EmbedAuthor } from '../discord-interactions/embeds'
import type { RunReport } from './engine'
import { HOLD_LABEL } from './policy'

export type MissionState = 'approved' | 'pending' | 'awaiting_release' | 'rejected' | 'open' | 'locked'

export interface MissionLine {
  missionId: number
  level: number
  title: string
  state: MissionState
  /** From this run's verifier check, when the mission has an automatic verifier. */
  check?: { status: 'pass' | 'fail' | 'unknown' | 'skipped'; reason?: string; hint?: string; progress?: { have: number; need: number } }
  holdReason?: MissionHold | null
  justApproved?: boolean
}

export interface MissionsView {
  enabled: boolean
  currentLevel: number
  levelTitle: string | null
  maxLevel: number
  earned: number
  missions: MissionLine[]
  approvedTitles: string[]
  heldTitles: string[]
  levelsPaid: number[]
}

type OverviewLike = {
  currentLevel: number
  levelTitle: string | null
  levels: Array<{
    level: number
    reward: number
    missions: Array<{ id: number; title: string; progress: { status: string; holdReason?: string | null } | null }>
  }>
}

export function buildMissionsView(overview: OverviewLike, report: RunReport): MissionsView {
  const checks = new Map(report.checks.map((c) => [c.missionId, c]))
  const missions: MissionLine[] = []
  for (const lvl of overview.levels) {
    for (const m of lvl.missions) {
      const c = checks.get(m.id)
      const status = m.progress?.status
      const hold = (m.progress?.holdReason ?? null) as MissionHold | null
      const state: MissionState =
        status === 'APPROVED'
          ? 'approved'
          : status === 'REJECTED'
            ? 'rejected'
            : status === 'PENDING'
              ? hold
                ? 'awaiting_release'
                : 'pending'
              : lvl.level > overview.currentLevel
                ? 'locked'
                : 'open'
      const line: MissionLine = { missionId: m.id, level: lvl.level, title: m.title, state, holdReason: hold }
      if (c) {
        const r = c.result
        line.check =
          r.status === 'fail'
            ? { status: 'fail', reason: r.reason, hint: r.hint, progress: r.progress }
            : r.status === 'unknown' || r.status === 'skipped'
              ? { status: r.status, reason: r.reason }
              : { status: 'pass' }
        line.justApproved = c.outcome === 'approved'
        if (c.holdReason) line.holdReason = c.holdReason
      }
      missions.push(line)
    }
  }
  const maxLevel = overview.levels.reduce((mx, l) => Math.max(mx, l.level), 0)
  const earned = overview.levels.filter((l) => l.level < overview.currentLevel).reduce((s, l) => s + l.reward, 0)
  const titleOf = (id: number) => missions.find((x) => x.missionId === id)?.title ?? `Mission ${id}`
  return {
    enabled: report.enabled,
    currentLevel: overview.currentLevel,
    levelTitle: overview.levelTitle,
    maxLevel,
    earned,
    missions,
    approvedTitles: report.approved.map(titleOf),
    heldTitles: report.held.map(titleOf),
    levelsPaid: report.levelsPaid,
  }
}

const ICON: Record<MissionState, string> = {
  approved: '✅',
  pending: '⏳',
  awaiting_release: '🔐',
  rejected: '❌',
  open: '▫️',
  locked: '🔒',
}

function lineText(l: MissionLine): string {
  let text = `${ICON[l.state]} ${l.title}`
  if (l.state === 'awaiting_release') text += ` (verified, awaiting a reviewer's release${l.holdReason ? `: ${HOLD_LABEL[l.holdReason]}` : ''})`
  else if (l.state === 'pending') text += ' (pending review)'
  else if (l.state !== 'approved' && l.check?.status === 'fail') {
    const p = l.check.progress ? ` ${l.check.progress.have}/${l.check.progress.need}` : ''
    text += `:${p} ${l.check.hint ?? l.check.reason ?? ''}`.trimEnd()
  } else if (l.state !== 'approved' && l.check?.status === 'pass') text += ' (verified)'
  return text.length > 240 ? text.slice(0, 239) + '…' : text
}

/** The /missions reply. */
export function renderMissionsEmbed(view: MissionsView, opts: { author?: EmbedAuthor; currency?: string; appUrl?: string } = {}): Embed {
  const cur = opts.currency ?? '$PEP'
  const n = (v: number) => v.toLocaleString('en-US')
  const done = view.currentLevel > view.maxLevel
  const head: string[] = [
    done ? '**All levels complete.**' : `Level **${view.currentLevel}**${view.levelTitle ? ` · ${view.levelTitle}` : ''}`,
    `Earned from missions: ${cur} ${n(view.earned)}`,
  ]
  if (!view.enabled) head.push('', '_Automatic checks are not switched on yet: this shows your progress only._')

  // Show the current level and the next one, plus anything above that is approved or held.
  const show = view.missions.filter(
    (l) => l.level <= view.currentLevel + 1 || l.state === 'approved' || l.state === 'awaiting_release' || l.state === 'pending',
  )
  const byLevel = new Map<number, MissionLine[]>()
  for (const l of show) byLevel.set(l.level, [...(byLevel.get(l.level) ?? []), l])
  const body: string[] = [...head]
  for (const [level, lines] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    if (level < view.currentLevel && lines.every((l) => l.state === 'approved')) continue // finished levels: skip
    body.push('', `**Level ${level}**`, ...lines.map(lineText))
  }
  if (opts.appUrl) body.push('', `[Open missions](<${opts.appUrl}/missions>)`)

  let tone: 'success' | 'cooldown' = 'cooldown'
  let headline = 'No new completions yet.'
  if (view.levelsPaid.length) {
    tone = 'success'
    headline = `Level ${view.levelsPaid[view.levelsPaid.length - 1]} complete!`
  } else if (view.approvedTitles.length) {
    tone = 'success'
    headline = `${view.approvedTitles.length} mission${view.approvedTitles.length > 1 ? 's' : ''} verified!`
  } else if (view.heldTitles.length) {
    tone = 'success'
    headline = 'Verified! A reviewer will release it.'
  }
  return makeEmbed(tone, headline, body.join('\n'), { author: opts.author })
}
