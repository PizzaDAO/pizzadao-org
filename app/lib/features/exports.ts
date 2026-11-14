/**
 * The machine-readable exports of the catalog (plans/features-catalog.md, 4.5): /features.json,
 * /features.md and /llms.txt. Pure formatters over PublicCatalog, so they can only ever contain what the
 * page may show. Private code entries carry the repo name and `private: true`, never a path or URL.
 */
import { AUDIENCE_LABELS, type PublicApp, type PublicCatalog, type PublicCodeRef, type PublicEntry } from './types'

export const NO_LICENSE_NOTE = 'No license file yet: ask before reusing code.'

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
    if (c.private) return `${c.repo} (private)`
    const label = c.path ? c.path : c.repo
    return c.url ? `[${label}](${c.url})` : label
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
    `Generated ${cat.generatedAt}. Human-readable page: ${o.siteUrl}/features. Machine-readable: ${o.siteUrl}/features.json.`,
    '',
  ]
  for (const app of cat.apps) {
    const entries = cat.entries.filter((e) => e.app === app.slug)
    if (!entries.length) continue
    lines.push(`## ${app.name}`, '')
    if (app.tagline) lines.push(app.tagline, '')
    const meta: string[] = []
    if (app.url) meta.push(`URL: ${app.url}`)
    if (app.repo) meta.push(`Repo: https://github.com/${app.repo}`)
    meta.push(`License: ${appLicenseText(app)}`)
    lines.push(meta.join(' | '), '')
    for (const e of entries) {
      const who = e.audiences.map((a) => AUDIENCE_LABELS[a]).join(', ')
      const head = `- **${e.title}** (${statusLabel(e)}${who ? `, ${who}` : ''}): ${e.summary}`
      const extras: string[] = []
      if (e.url) extras.push(`Open: ${e.url}`)
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
    `- [Features (Markdown)](${o.siteUrl}/features.md): every published feature with its live link and code links`,
    `- [Features (JSON)](${o.siteUrl}/features.json): the same data with pinned commit links`,
    `- [Features (web page)](${o.siteUrl}/features)`,
    '',
    '## Apps',
    '',
  ]
  for (const a of cat.apps) {
    const link = a.url ?? (a.repo ? `https://github.com/${a.repo}` : null)
    lines.push(link ? `- [${a.name}](${link}): ${a.tagline}` : `- ${a.name}: ${a.tagline}`)
  }
  lines.push('', '## Reuse', '')
  lines.push('Check each repo\'s license before reusing code. Repos without a license file are not yet cleared for reuse: ask first.')
  const licensed = cat.apps.filter((a) => a.repo)
  for (const a of licensed) lines.push(`- ${a.name} (${a.repo}): ${appLicenseText(a)}`)
  return `${lines.join('\n').trimEnd()}\n`
}
