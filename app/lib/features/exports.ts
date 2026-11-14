/**
 * The machine-readable exports of the catalog (plans/features-catalog.md, 4.5): /features.json,
 * /features.md and /llms.txt. Pure formatters over PublicCatalog, so they can only ever contain what the
 * page may show. Private code entries carry the repo name and `private: true`, never a path or URL.
 */
import { safeHttpUrl } from './links'
import { AUDIENCE_LABELS, type PublicApp, type PublicCatalog, type PublicCodeRef, type PublicEntry } from './types'

export const NO_LICENSE_NOTE = 'No license file yet: ask before reusing code.'

/** Collapse line breaks and backslash-escape Markdown specials so a row can't inject formatting or links. */
export function md(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/([\\`*_{}[\]()<>#+!|~])/g, '\\$1')
}

/** A URL safe inside a Markdown link target: https only, parentheses and spaces encoded. */
function mdUrl(url: string | null | undefined): string | null {
  const safe = safeHttpUrl(url)
  return safe ? safe.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20') : null
}

export interface ExportOptions {
  /** Origin the links in the export point at (follows the site origin, so it moves at cutover). */
  siteUrl: string
}

function appLicenseText(a: PublicApp): string {
  if (a.license) return a.license
  return a.licenseNote || NO_LICENSE_NOTE
}

function jsonCode(c: PublicCodeRef) {
  if (c.private) return { repo: c.repo, private: true }
  return {
    repo: c.repo,
    ...(c.path ? { path: c.path } : {}),
    ...(c.description ? { description: c.description } : {}),
    url: c.url ?? null,
    permalink: c.permalink ?? null,
    license: c.license ?? null,
  }
}

export function toJson(cat: PublicCatalog, o: ExportOptions) {
  return {
    generatedAt: cat.generatedAt,
    source: `${o.siteUrl}/features`,
    apps: cat.apps.map((a) => ({
      slug: a.slug,
      name: a.name,
      tagline: a.tagline,
      kind: a.kind,
      url: a.url,
      repo: a.repo,
      defaultBranch: a.defaultBranch,
      commit: a.commit,
      license: a.license,
      licenseNote: a.license ? null : a.licenseNote || NO_LICENSE_NOTE,
    })),
    features: cat.entries.map((e) => ({
      slug: e.slug,
      app: e.app,
      title: e.title,
      summary: e.summary,
      audiences: e.audiences,
      status: e.status === 'soon' ? 'coming-soon' : e.status,
      access: e.access,
      url: e.url,
      docsUrl: e.docsUrl,
      code: e.code.map(jsonCode),
    })),
  }
}

function codeLinks(e: PublicEntry): string {
  const parts = e.code.map((c) => {
    if (c.private) return `${md(c.repo)} (private)`
    const label = md(c.path ? c.path : c.repo)
    const url = mdUrl(c.url)
    return url ? `[${label}](${url})` : label
  })
  return parts.join(', ')
}

function statusLabel(e: PublicEntry): string {
  if (e.status === 'soon') return e.code.length && e.code.every((c) => c.private) ? 'private, coming soon' : 'coming soon'
  return e.status
}

export function toMarkdown(cat: PublicCatalog, o: ExportOptions): string {
  const lines: string[] = [
    '# What PizzaDAO has built',
    '',
    `Generated ${cat.generatedAt}. Human-readable page: ${md(o.siteUrl)}/features. Machine-readable: ${md(o.siteUrl)}/features.json.`,
    '',
  ]
  for (const app of cat.apps) {
    const entries = cat.entries.filter((e) => e.app === app.slug)
    if (!entries.length) continue
    lines.push(`## ${md(app.name)}`, '')
    if (app.tagline) lines.push(md(app.tagline), '')
    const meta: string[] = []
    const appUrl = safeHttpUrl(app.url)
    if (appUrl) meta.push(`URL: ${md(appUrl)}`)
    if (app.repo) meta.push(`Repo: https://github.com/${md(app.repo)}`)
    meta.push(`License: ${md(appLicenseText(app))}`)
    lines.push(meta.join(' | '), '')
    for (const e of entries) {
      const who = e.audiences.map((a) => AUDIENCE_LABELS[a]).join(', ')
      const head = `- **${md(e.title)}** (${statusLabel(e)}${who ? `, ${md(who)}` : ''}): ${md(e.summary)}`
      const extras: string[] = []
      const open = mdUrl(e.url)
      if (open) extras.push(`Open: ${open}`)
      const code = codeLinks(e)
      if (code) extras.push(`Code: ${code}`)
      lines.push(extras.length ? `${head} ${extras.join('. ')}.` : head)
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function toLlmsTxt(cat: PublicCatalog, o: ExportOptions): string {
  const lines: string[] = [
    '# PizzaDAO',
    '',
    '> PizzaDAO is a community of pizza lovers, builders and event hosts. This file lists what the DAO has built, in a form meant for AI agents and people who want to reuse it.',
    '',
    '## Features',
    '',
    `- [Features (Markdown)](${mdUrl(o.siteUrl)}/features.md): every published feature with its live link and code links`,
    `- [Features (JSON)](${mdUrl(o.siteUrl)}/features.json): the same data with pinned commit links`,
    `- [Features (web page)](${mdUrl(o.siteUrl)}/features)`,
    '',
    '## Apps',
    '',
  ]
  for (const a of cat.apps) {
    const link = mdUrl(a.url) ?? (a.repo ? mdUrl(`https://github.com/${a.repo}`) : null)
    lines.push(link ? `- [${md(a.name)}](${link}): ${md(a.tagline)}` : `- ${md(a.name)}: ${md(a.tagline)}`)
  }
  lines.push('', '## Reuse', '')
  lines.push('Check each repo\'s license before reusing code. Repos without a license file are not yet cleared for reuse: ask first.')
  const licensed = cat.apps.filter((a) => a.repo)
  for (const a of licensed) lines.push(`- ${md(a.name)} (${md(a.repo as string)}): ${md(appLicenseText(a))}`)
  return `${lines.join('\n').trimEnd()}\n`
}
