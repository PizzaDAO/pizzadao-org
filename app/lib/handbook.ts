/**
 * Handbook loader and renderer helpers (plans/onboarding-guide.md).
 *
 * Prose lives in content/handbook/<slug>/<locale>.ts. Facts that change live in the admin
 * settings (`guide.*`) and are filled into whitelisted `{{placeholders}}`:
 *
 *   {{gppDate}}                       inline value
 *   a paragraph with an empty value   dropped (so an unset link hides its sentence)
 *   a list item with an empty value   that line is dropped
 *   ::if hostDeadlines ... ::end      the section is dropped while the fact is empty
 */
import { HANDBOOK_LOADERS, type HandbookModule, type HandbookSlug } from '@/content/handbook'
import { DEFAULT_LOCALE, type SupportedLocale } from '@/app/lib/i18n/locales'
import { loadSettings } from '@/app/lib/settings'
import type { SettingKey } from '@/app/lib/settings/registry'

/** The only placeholder names a page may use, and the setting each one reads. */
export const FACT_SETTING = {
  discordUrl: 'guide.discordUrl',
  eventsUrl: 'guide.eventsUrl',
  gppDate: 'guide.gppDate',
  gppEdition: 'guide.gppEdition',
  hostCapUsd: 'guide.hostCapUsd',
  budgetTemplateUrl: 'guide.budgetTemplateUrl',
  paymentFormUrl: 'guide.paymentFormUrl',
  hostPlaybookUrl: 'guide.hostPlaybookUrl',
  hashtags: 'guide.hashtags',
  hostDeadlines: 'guide.hostDeadlines',
} as const satisfies Record<string, SettingKey>

export type FactKey = keyof typeof FACT_SETTING
export type HandbookFacts = Record<FactKey, string>

const FACT_KEYS = Object.keys(FACT_SETTING) as FactKey[]
const URL_FACTS = new Set<string>(['discordUrl', 'eventsUrl', 'budgetTemplateUrl', 'paymentFormUrl', 'hostPlaybookUrl'])

export const isFactKey = (k: string): k is FactKey => Object.prototype.hasOwnProperty.call(FACT_SETTING, k)

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/
const IF_LINE = /^\s*::if\s+([A-Za-z][A-Za-z0-9]*)\s*$/
const END_LINE = /^\s*::end\s*$/

/** Every placeholder name used in a body, including `::if` conditions (for tests). */
export function placeholdersIn(body: string): string[] {
  const names = new Set<string>()
  for (const m of body.matchAll(PLACEHOLDER)) names.add(m[1])
  for (const line of body.split('\n')) {
    const m = IF_LINE.exec(line)
    if (m) names.add(m[1])
  }
  return [...names]
}

/** Explicit heading anchors, `## Title {#anchor}`. */
export function extractAnchors(body: string): string[] {
  return [...body.matchAll(/^#{1,6}\s+.*\{#([a-z0-9-]+)\}\s*$/gm)].map((m) => m[1])
}

/** Internal link targets, `](/path#anchor)`. */
export function internalLinks(body: string): string[] {
  return [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1])
}

function safeUrl(v: string): string {
  return v.replace(/\\/g, '%5C').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20')
}

/**
 * Fill facts into a page body. Unknown placeholder names are left as written (a test fails on
 * them). See the file header for how empty values hide text.
 */
export function renderPlaceholders(body: string, facts: Partial<Record<string, string>>): string {
  const value = (k: string): string | null => (isFactKey(k) ? (facts[k] ?? '').trim() : null)

  // 1. ::if sections.
  const kept: string[] = []
  let skipping = false
  for (const line of body.split('\n')) {
    const cond = IF_LINE.exec(line)
    if (cond) {
      skipping = value(cond[1]) === ''
      continue
    }
    if (END_LINE.test(line)) {
      skipping = false
      continue
    }
    if (!skipping) kept.push(line)
  }

  // 2. Blocks: drop or keep, then substitute.
  const hasEmpty = (text: string) => [...text.matchAll(PLACEHOLDER)].some((m) => value(m[1]) === '')
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (whole, k: string) => {
      const v = value(k)
      if (v === null) return whole
      return URL_FACTS.has(k) ? safeUrl(v) : v
    })

  const out: string[] = []
  for (const block of kept.join('\n').split(/\n[ \t]*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (lines.length === 0) continue
    if (lines.every((l) => LIST_LINE.test(l))) {
      const keep = lines.filter((l) => !hasEmpty(l))
      if (keep.length) out.push(fill(keep.join('\n')))
    } else if (!hasEmpty(block)) {
      out.push(fill(lines.join('\n')))
    }
  }
  return out.join('\n\n')
}

/** "YYYY-MM-DD" as a long date in the reader's language ('' when unset or unparseable). */
export function formatFactDate(iso: string, locale: SupportedLocale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(d)
}

/** The handbook facts for a reader's language. Never throws: an unreadable setting is unset. */
export async function getHandbookFacts(locale: SupportedLocale): Promise<HandbookFacts> {
  const facts = Object.fromEntries(FACT_KEYS.map((k) => [k, ''])) as HandbookFacts
  try {
    const s = await loadSettings()
    for (const k of FACT_KEYS) {
      const v = s.get(FACT_SETTING[k]) as unknown
      if (typeof v === 'number') {
        facts[k] =
          v <= 0
            ? ''
            : k === 'hostCapUsd'
              ? new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
              : String(v)
      } else if (typeof v === 'string') {
        facts[k] = k === 'gppDate' ? formatFactDate(v, locale) : v
      }
    }
  } catch {
    /* every fact stays unset, so dependent text is hidden */
  }
  return facts
}

export interface HandbookPage {
  slug: HandbookSlug
  title: string
  dek: string
  reviewed: string
  body: string
  /** The reader's language was missing, so English is shown. */
  fellBack: boolean
}

export async function getHandbookPage(slug: HandbookSlug, locale: SupportedLocale): Promise<HandbookPage> {
  let mod: HandbookModule
  let fellBack = false
  try {
    mod = await HANDBOOK_LOADERS[slug][locale]()
  } catch {
    mod = await HANDBOOK_LOADERS[slug][DEFAULT_LOCALE]()
    fellBack = locale !== DEFAULT_LOCALE
  }
  return { slug, title: mod.title, dek: mod.dek, reviewed: mod.reviewed, body: mod.body, fellBack }
}

/** True when "YYYY-MM" is more than 12 months before `now`. */
export function isStale(reviewed: string, now: Date = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(reviewed)
  if (!m) return false
  const months = now.getUTCFullYear() * 12 + now.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1)
  return months > 12
}

export function formatReviewed(reviewed: string, locale: SupportedLocale): string {
  const m = /^(\d{4})-(\d{2})$/.exec(reviewed)
  if (!m) return reviewed
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1, 12)),
  )
}
