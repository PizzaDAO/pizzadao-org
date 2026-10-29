/**
 * Handbook page registry (plans/onboarding-guide.md). One entry per page, in display order, plus
 * a static import() map per slug and locale (no fs reads, so nothing to trace on Vercel and the
 * type checker sees a missing file).
 *
 * Every page module exports `title`, `dek`, `reviewed` ("YYYY-MM") and `body` (Markdown, no raw
 * HTML). Headings carry an explicit trailing `{#anchor}` that stays identical across languages.
 * Facts that change (dates, caps, links) are NEVER written in the body: use a `{{placeholder}}`
 * from app/lib/handbook.ts, or the generated level table.
 */
import type { SupportedLocale } from '@/app/lib/i18n/locales'

export type HandbookGroup = 'newMember' | 'hosting' | 'takingPart'

export interface HandbookModule {
  title: string
  dek: string
  /** "YYYY-MM": when a person last checked the page against reality. */
  reviewed: string
  body: string
}

export interface HandbookPageDef {
  slug: string
  group: HandbookGroup
  /** Anchors the page renders itself (not from the Markdown), e.g. the generated level table. */
  dynamicAnchors?: readonly string[]
  /** Render the live level table after the body. */
  levelsTable?: boolean
}

export const HANDBOOK_PAGES = [
  { slug: 'getting-started', group: 'newMember' },
  {
    slug: 'levels',
    group: 'newMember',
    levelsTable: true,
    dynamicAnchors: ['level-1', 'level-2', 'level-3', 'level-4', 'level-5', 'level-6', 'level-7', 'level-8', 'level-9'],
  },
] as const satisfies readonly HandbookPageDef[]

export type HandbookSlug = (typeof HANDBOOK_PAGES)[number]['slug']

type Loaders = Record<HandbookSlug, Record<SupportedLocale, () => Promise<HandbookModule>>>

export const HANDBOOK_LOADERS: Loaders = {
  'getting-started': {
    en: () => import('./getting-started/en'),
    es: () => import('./getting-started/es'),
    fr: () => import('./getting-started/fr'),
  },
  levels: {
    en: () => import('./levels/en'),
    es: () => import('./levels/es'),
    fr: () => import('./levels/fr'),
  },
}

export function isHandbookSlug(slug: string): slug is HandbookSlug {
  return HANDBOOK_PAGES.some((p) => p.slug === slug)
}

export function handbookPageDef(slug: HandbookSlug): HandbookPageDef {
  return HANDBOOK_PAGES.find((p) => p.slug === slug) as HandbookPageDef
}
