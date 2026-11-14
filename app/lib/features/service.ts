/**
 * Reads the catalog for the public page and the exports: rows from the database, the live switch
 * state from the settings, repo facts from GitHub (cached, fail soft).
 */
import { prisma } from '@/app/lib/db'
import { SITE_URL } from '@/app/lib/site-url'
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { buildPublicCatalog } from './catalog'
import { sharedGithubClient, type GithubClient } from './github'
import { parseCodeRefs, repoName } from './links'
import { settingIsOn } from './switches'
import type { AppRow, EntryRow, PublicCatalog, RepoFacts, RepoFactsMap } from './types'

export interface CatalogSwitches {
  publicEnabled: boolean
  exportEnabled: boolean
  navLinkEnabled: boolean
  showOps: boolean
  introText: string
  contributeUrl: string
  githubCacheMinutes: number
}

export async function loadSwitches(): Promise<CatalogSwitches> {
  const s = await loadSettings()
  return {
    publicEnabled: resolveToggle('features.publicEnabled', s),
    exportEnabled: resolveToggle('features.exportEnabled', s),
    navLinkEnabled: resolveToggle('features.navLinkEnabled', s),
    showOps: resolveToggle('features.showOps', s),
    introText: s.get('features.introText'),
    contributeUrl: s.get('features.contributeUrl'),
    githubCacheMinutes: s.get('features.githubCacheMinutes'),
  }
}

/** Facts for the repos the visible rows point at, with the head commit when asked (exports). */
export async function gatherFacts(
  client: GithubClient,
  entries: EntryRow[],
  apps: AppRow[],
  withCommits: boolean,
): Promise<{ facts: RepoFactsMap; githubOk: boolean }> {
  const listed = await client.listRepos()
  if (!listed) return { facts: new Map(), githubOk: false }
  const facts: RepoFactsMap = new Map()
  for (const [k, v] of listed) facts.set(k, { ...v })
  if (withCommits) {
    const wanted = new Set<string>()
    for (const a of apps) if (a.published && a.repo) wanted.add(repoName(a.repo))
    for (const e of entries) if (e.published) for (const r of parseCodeRefs(e.code)) if (!r.private) wanted.add(repoName(r.repo))
    const repos = [...wanted].filter((r) => facts.has(r) && !facts.get(r)!.private)
    let i = 0
    const worker = async () => {
      while (i < repos.length) {
        const name = repos[i++]
        const f = facts.get(name) as RepoFacts
        const branch = f.defaultBranch ?? 'main'
        f.commit = await client.headCommit(name, branch)
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
  }
  return { facts, githubOk: true }
}

export async function getPublicCatalog(opts: { withCommits?: boolean } = {}): Promise<{ catalog: PublicCatalog; switches: CatalogSwitches }> {
  const [settings, apps, entries] = await Promise.all([
    loadSettings(),
    prisma.featureApp.findMany({ where: { published: true } }),
    prisma.featureEntry.findMany({ where: { published: true } }),
  ])
  const switches = await loadSwitches()
  const client = sharedGithubClient(switches.githubCacheMinutes)
  const { facts, githubOk } = await gatherFacts(client, entries as EntryRow[], apps as AppRow[], !!opts.withCommits)
  const catalog = buildPublicCatalog({
    apps: apps as AppRow[],
    entries: entries as EntryRow[],
    facts,
    githubOk,
    isOn: (key) => settingIsOn(key, settings),
    showOps: switches.showOps,
    siteUrl: SITE_URL,
  })
  return { catalog, switches }
}
