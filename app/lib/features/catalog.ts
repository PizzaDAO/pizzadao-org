/**
 * Turns the stored catalog rows into what a visitor may see. Pure: every filter that keeps
 * unlaunched or private work off the public page and the exports lives here, and the page and all three
 * exports read this one function (plans/features-catalog.md, sections 4.2 and 6).
 */
import { codeUrl, fullRepo, parseCodeRefs, repoName, resolveLiveUrl, safeHttpUrl } from './links'
import {
  AUDIENCES,
  type AppRow,
  type Audience,
  type EntryRow,
  type PublicApp,
  type PublicCatalog,
  type PublicCodeRef,
  type PublicEntry,
  type PublicStatus,
  type RepoFacts,
  type RepoFactsMap,
} from './types'

export interface BuildInput {
  apps: AppRow[]
  entries: EntryRow[]
  facts: RepoFactsMap
  /** False when the GitHub lookup failed: visibility then falls back to the stored flags. */
  githubOk: boolean
  /** The live state of a settings key; null when the key is unknown. */
  isOn: (key: string) => boolean | null
  showOps: boolean
  siteUrl: string
  now?: Date
}

/** Status a visitor sees for one row, or null when the row is hidden. */
export function publicStatus(
  entry: Pick<EntryRow, 'status' | 'toggleKey' | 'showWhenOff'>,
  isOn: (key: string) => boolean | null,
): PublicStatus | null {
  if (entry.status === 'private') return 'soon'
  if (entry.status === 'offline' || entry.status === 'retired') return null
  let on = entry.status !== 'off'
  if (entry.toggleKey) {
    // An unknown key counts as off: never announce something we cannot confirm is running.
    on = isOn(entry.toggleKey) === true
  }
  if (!on) return entry.showWhenOff ? 'soon' : null
  return entry.status === 'beta' ? 'beta' : 'live'
}

function cleanLicense(l: string | null | undefined): string | null {
  if (!l || l === 'NOASSERTION') return null
  return l
}

export function buildPublicCatalog(input: BuildInput): PublicCatalog {
  const { githubOk, facts } = input
  const apps = [...input.apps].sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))
  const appBySlug = new Map(apps.map((a) => [a.slug, a]))
  const appByRepo = new Map<string, AppRow>()
  for (const a of apps) if (a.repo && !appByRepo.has(repoName(a.repo))) appByRepo.set(repoName(a.repo), a)

  const factsFor = (repo: string): RepoFacts | undefined => facts.get(repoName(repo))

  /** Whether the repo may be linked: not flagged private, and (when GitHub answered) listed as public. */
  const repoIsPublic = (repo: string): boolean => {
    const owner = appByRepo.get(repoName(repo))
    if (owner?.repoPrivate) return false
    // GitHub unreachable: only a repo with a catalog row that is not flagged private is trusted.
    if (!githubOk) return !!owner
    const f = factsFor(repo)
    return !!f && !f.private
  }

  const licenseFor = (repo: string): string | null =>
    cleanLicense(appByRepo.get(repoName(repo))?.license) ?? cleanLicense(factsFor(repo)?.license)

  const refs = (entry: EntryRow): PublicCodeRef[] => {
    const out: PublicCodeRef[] = []
    for (const ref of parseCodeRefs(entry.code)) {
      // Private rows and private repos never carry a path, description or URL.
      if (entry.status === 'private' || ref.private || !repoIsPublic(ref.repo)) {
        out.push({ repo: ref.repo, private: true })
        continue
      }
      const f = factsFor(ref.repo)
      // HEAD is GitHub's alias for the default branch, used when neither GitHub nor the catalog knows it.
      const branch = f?.defaultBranch ?? appByRepo.get(repoName(ref.repo))?.defaultBranch ?? 'HEAD'
      const item: PublicCodeRef = {
        repo: ref.repo,
        ...(ref.path ? { path: ref.path } : {}),
        ...(ref.description ? { description: ref.description } : {}),
        url: codeUrl(ref.repo, branch, ref.path),
        license: licenseFor(ref.repo),
      }
      if (f?.commit) item.permalink = codeUrl(ref.repo, f.commit, ref.path)
      out.push(item)
    }
    return out
  }

  const entries: PublicEntry[] = []
  for (const e of [...input.entries].sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))) {
    if (!e.published) continue
    const app = appBySlug.get(e.appSlug)
    if (!app || !app.published) continue
    const status = publicStatus(e, input.isOn)
    if (!status) continue
    const audiences = e.audiences.filter((a): a is Audience => (AUDIENCES as readonly string[]).includes(a))
    // Any ops audience marks the row as an ops tool: hidden unless features.showOps.
    const opsOnly = audiences.includes('ops')
    if (opsOnly && !input.showOps) continue

    const priv = e.status === 'private'
    const base = safeHttpUrl(app.url) ?? input.siteUrl
    const showUrl = !priv && e.access !== 'admin'
    entries.push({
      slug: e.slug,
      app: e.appSlug,
      title: e.title,
      summary: e.summary,
      audiences,
      tags: e.tags,
      status,
      access: e.access,
      url: showUrl ? resolveLiveUrl(e.liveUrl, base) : null,
      docsUrl: priv ? null : safeHttpUrl(e.docsUrl),
      ops: opsOnly,
      code: refs(e),
    })
  }

  const usedApps = new Set(entries.map((e) => e.app))
  const publicApps: PublicApp[] = apps
    .filter((a) => usedApps.has(a.slug))
    .map((a) => {
      const repoOk = !!a.repo && repoIsPublic(a.repo)
      const f = a.repo ? factsFor(a.repo) : undefined
      return {
        slug: a.slug,
        name: a.name,
        tagline: a.tagline,
        kind: a.kind,
        url: safeHttpUrl(a.url) ?? (a.slug === 'pizzadao-org' ? input.siteUrl : null),
        repo: repoOk ? fullRepo(a.repo as string) : null,
        defaultBranch: repoOk ? (f?.defaultBranch ?? a.defaultBranch ?? null) : null,
        commit: repoOk ? (f?.commit ?? null) : null,
        license: repoOk ? licenseFor(a.repo as string) : null,
        licenseNote: repoOk ? a.licenseNote : null,
        pushedAt: repoOk ? (f?.pushedAt ?? null) : null,
      }
    })

  return { generatedAt: (input.now ?? new Date()).toISOString(), apps: publicApps, entries, githubOk }
}
