// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { HANDBOOK_LOADERS, HANDBOOK_PAGES, handbookPageDef, isHandbookSlug, type HandbookModule, type HandbookSlug } from '@/content/handbook'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/app/lib/i18n/locales'
import { SETTINGS } from '@/app/lib/settings/registry'
import {
  FACT_SETTING,
  extractAnchors,
  formatFactDate,
  getHandbookPage,
  internalLinks,
  isFactKey,
  isStale,
  placeholdersIn,
  renderPlaceholders,
} from '@/app/lib/handbook'

const SLUGS = HANDBOOK_PAGES.map((p) => p.slug) as HandbookSlug[]
const root = join(__dirname, '..', '..', '..')

async function load(slug: HandbookSlug, locale: SupportedLocale): Promise<HandbookModule> {
  return HANDBOOK_LOADERS[slug][locale]()
}

/** Anchors a page offers in English (Markdown headings plus the ones the page renders itself). */
async function anchorsOf(slug: HandbookSlug): Promise<Set<string>> {
  const en = await load(slug, 'en')
  return new Set([...extractAnchors(en.body), ...(handbookPageDef(slug).dynamicAnchors ?? [])])
}

/** Does this internal link point at a real route (and, for the handbook, a real anchor)? */
export async function linkResolves(href: string): Promise<boolean> {
  const [pathAndQuery, hash] = href.split('#')
  const path = pathAndQuery.split('?')[0].replace(/\/$/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'handbook' && parts.length === 2) {
    if (!isHandbookSlug(parts[1])) return false
    return hash ? (await anchorsOf(parts[1])).has(hash) : true
  }
  return existsSync(join(root, 'app', ...parts, 'page.tsx'))
}

describe('handbook content', () => {
  it('registers at least one page and every slug is unique', () => {
    expect(SLUGS.length).toBeGreaterThan(0)
    expect(new Set(SLUGS).size).toBe(SLUGS.length)
  })

  it('every slug has an en, es and fr module with title, dek, reviewed and body', async () => {
    for (const slug of SLUGS) {
      for (const locale of SUPPORTED_LOCALES) {
        const m = await load(slug, locale)
        expect(m.title.trim(), `${slug}/${locale} title`).not.toBe('')
        expect(m.dek.trim(), `${slug}/${locale} dek`).not.toBe('')
        expect(m.reviewed, `${slug}/${locale} reviewed`).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
        expect(m.body.trim().length, `${slug}/${locale} body`).toBeGreaterThan(200)
      }
    }
  })

  it('each locale has exactly the English set of {#anchors}, in the same order', async () => {
    for (const slug of SLUGS) {
      const en = extractAnchors((await load(slug, 'en')).body)
      expect(en.length, `${slug} has anchors`).toBeGreaterThan(0)
      expect(new Set(en).size, `${slug} anchors are unique`).toBe(en.length)
      for (const locale of SUPPORTED_LOCALES) {
        expect(extractAnchors((await load(slug, locale)).body), `${slug}/${locale}`).toEqual(en)
      }
    }
  })

  it('every heading has an explicit anchor (so deep links work in every language)', async () => {
    for (const slug of SLUGS) {
      for (const locale of SUPPORTED_LOCALES) {
        const headings = (await load(slug, locale)).body.split('\n').filter((l) => /^#{2,3}\s/.test(l))
        for (const h of headings) expect(h, `${slug}/${locale}`).toMatch(/\{#[a-z0-9-]+\}\s*$/)
      }
    }
  })

  it('uses only whitelisted placeholders, and each whitelisted fact reads a real guide setting', async () => {
    for (const k of Object.keys(FACT_SETTING)) expect(SETTINGS[FACT_SETTING[k as keyof typeof FACT_SETTING]], k).toBeDefined()
    for (const slug of SLUGS) {
      for (const locale of SUPPORTED_LOCALES) {
        for (const name of placeholdersIn((await load(slug, locale)).body)) {
          expect(isFactKey(name), `${slug}/${locale}: unknown placeholder ${name}`).toBe(true)
        }
      }
    }
  })

  it('uses the same placeholders and ::if blocks in every language', async () => {
    for (const slug of SLUGS) {
      const en = (await load(slug, 'en')).body
      for (const locale of SUPPORTED_LOCALES) {
        const body = (await load(slug, locale)).body
        expect(placeholdersIn(body).sort(), `${slug}/${locale}`).toEqual(placeholdersIn(en).sort())
        expect((body.match(/^\s*::if /gm) ?? []).length).toBe((en.match(/^\s*::if /gm) ?? []).length)
        expect((body.match(/^\s*::end\s*$/gm) ?? []).length).toBe((en.match(/^\s*::end\s*$/gm) ?? []).length)
      }
    }
  })

  it('contains no raw HTML and no fenced code', async () => {
    for (const slug of SLUGS) {
      for (const locale of SUPPORTED_LOCALES) {
        const body = (await load(slug, locale)).body.replace(/`[^`]*`/g, '')
        expect(body, `${slug}/${locale}`).not.toMatch(/<[a-z!/]/i)
      }
    }
  })

  it('contains no private links or hard-coded external URLs', async () => {
    for (const slug of SLUGS) {
      for (const locale of SUPPORTED_LOCALES) {
        const body = (await load(slug, locale)).body
        expect(body, `${slug}/${locale}`).not.toMatch(/https?:\/\//i)
        expect(body, `${slug}/${locale}`).not.toMatch(/drive\.google|docs\.google/i)
      }
    }
  })

  it('every internal link resolves to a route or a handbook page#anchor', async () => {
    for (const slug of SLUGS) {
      for (const locale of SUPPORTED_LOCALES) {
        for (const href of internalLinks((await load(slug, locale)).body)) {
          expect(await linkResolves(href), `${slug}/${locale}: broken link ${href}`).toBe(true)
        }
      }
    }
  })

  it('the link checker itself rejects bad targets', async () => {
    expect(await linkResolves('/handbook/levels#vouching')).toBe(true)
    expect(await linkResolves('/handbook/levels#level-6')).toBe(true)
    expect(await linkResolves('/handbook/levels#nope')).toBe(false)
    expect(await linkResolves('/handbook/nope')).toBe(false)
    expect(await linkResolves('/definitely-not-a-route')).toBe(false)
    expect(await linkResolves('/calls/how-to-attend')).toBe(true)
  })
})

describe('renderPlaceholders', () => {
  const facts = { hostCapUsd: '$625', budgetTemplateUrl: '', gppDate: 'May 22, 2027', hostDeadlines: '' }

  it('fills known placeholders', () => {
    expect(renderPlaceholders('Cap is {{hostCapUsd}} on {{gppDate}}.', facts)).toBe('Cap is $625 on May 22, 2027.')
  })

  it('drops a paragraph whose value is empty and keeps the others', () => {
    const out = renderPlaceholders('Keep me.\n\nCopy [the template]({{budgetTemplateUrl}}).\n\nAnd me.', facts)
    expect(out).toBe('Keep me.\n\nAnd me.')
  })

  it('drops only the list lines with an empty value', () => {
    const out = renderPlaceholders('- one {{hostCapUsd}}\n- two [x]({{budgetTemplateUrl}})\n- three', facts)
    expect(out).toBe('- one $625\n- three')
  })

  it('drops an ::if section while its fact is empty, and keeps it once set', () => {
    const body = 'Before.\n\n::if hostDeadlines\n## Deadlines {#deadlines}\n\n{{hostDeadlines}}\n::end\n\nAfter.'
    expect(renderPlaceholders(body, facts)).toBe('Before.\n\nAfter.')
    expect(renderPlaceholders(body, { ...facts, hostDeadlines: '- A\n- B' })).toBe('Before.\n\n## Deadlines {#deadlines}\n\n- A\n- B\n\nAfter.')
  })

  it('leaves unknown placeholders as written (a test catches them)', () => {
    expect(renderPlaceholders('See {{nope}} here.', facts)).toBe('See {{nope}} here.')
  })

  it('escapes parentheses and spaces in URL facts so a link cannot break out', () => {
    const out = renderPlaceholders('[x]({{budgetTemplateUrl}})', { budgetTemplateUrl: 'https://example.org/a b)(c' })
    expect(out).toBe('[x](https://example.org/a%20b%29%28c)')
  })

  it('escapes a backslash in URL facts', () => {
    expect(renderPlaceholders('[x]({{budgetTemplateUrl}})', { budgetTemplateUrl: 'https://example.org/a\\b' })).toBe('[x](https://example.org/a%5Cb)')
  })

  it('treats an unset or missing fact as empty', () => {
    expect(renderPlaceholders('Date {{gppDate}}.\n\nOk.', {})).toBe('Ok.')
  })
})

describe('handbook helpers', () => {
  it('formats the party date per locale and ignores junk', () => {
    expect(formatFactDate('2027-05-22', 'en')).toMatch(/May 22, 2027/)
    expect(formatFactDate('2027-05-22', 'es')).toMatch(/22 de mayo de 2027/)
    expect(formatFactDate('2027-05-22', 'fr')).toMatch(/22 mai 2027/)
    expect(formatFactDate('', 'en')).toBe('')
    expect(formatFactDate('2027-13-40', 'en')).toBe('')
  })

  it('flags a page as stale only after 12 months', () => {
    const now = new Date('2027-10-15T00:00:00Z')
    expect(isStale('2026-10', now)).toBe(false)
    expect(isStale('2026-09', now)).toBe(true)
    expect(isStale('garbage', now)).toBe(false)
  })

  it('serves the English page when a locale is missing', async () => {
    const en = await getHandbookPage('getting-started', 'en')
    expect(en.fellBack).toBe(false)
    const loader = HANDBOOK_LOADERS['getting-started']
    const original = loader.es
    loader.es = () => Promise.reject(new Error('missing'))
    try {
      const es = await getHandbookPage('getting-started', 'es')
      expect(es.fellBack).toBe(true)
      expect(es.title).toBe(en.title)
    } finally {
      loader.es = original
    }
  })

  it('rejects unknown slugs', () => {
    expect(isHandbookSlug('getting-started')).toBe(true)
    expect(isHandbookSlug('nope')).toBe(false)
    expect(isHandbookSlug('constructor')).toBe(false)
  })
})
