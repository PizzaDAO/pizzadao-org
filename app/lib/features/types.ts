/** Shared shapes for the public features catalog (plans/features-catalog.md). */

export const AUDIENCES = ['members', 'hosts', 'partners', 'builders', 'crews', 'ops'] as const
export type Audience = (typeof AUDIENCES)[number]

export const AUDIENCE_LABELS: Record<Audience, string> = {
  members: 'Members',
  hosts: 'Event hosts',
  partners: 'Pizzerias & partners',
  builders: 'Builders',
  crews: 'Crews & leads',
  ops: 'How we run the DAO',
}

export const ENTRY_STATUSES = ['live', 'beta', 'off', 'private', 'offline', 'retired'] as const
export type EntryStatus = (typeof ENTRY_STATUSES)[number]

/** What a visitor sees: live, beta, or "soon" (private repos, or a switched-off row that is set to show). */
export type PublicStatus = 'live' | 'beta' | 'soon'

export const APP_KINDS = ['app', 'bot', 'library', 'api', 'game', 'site'] as const
export type AppKind = (typeof APP_KINDS)[number]

/** One pointer to code. Paths are repo-relative; an empty path means the repo root. */
export interface CodeRef {
  /** "PizzaDAO/<name>" */
  repo: string
  path?: string
  description?: string
  private?: boolean
}

export interface AppRow {
  slug: string
  name: string
  tagline: string
  url: string | null
  repo: string | null
  repoPrivate: boolean
  defaultBranch: string | null
  license: string | null
  licenseNote: string | null
  kind: string
  position: number
  published: boolean
}

export interface EntryRow {
  slug: string
  appSlug: string
  title: string
  summary: string
  body: string | null
  audiences: string[]
  tags: string[]
  status: string
  access: string
  toggleKey: string | null
  liveUrl: string | null
  docsUrl: string | null
  screenshotUrl: string | null
  code: unknown
  published: boolean
  showWhenOff: boolean
  position: number
}

/** What GitHub told us about one repo (all optional: the lookup fails soft). */
export interface RepoFacts {
  private: boolean
  defaultBranch: string | null
  license: string | null
  pushedAt: string | null
  archived: boolean
  /** SHA of the default branch HEAD, when fetched (exports only). */
  commit?: string | null
}

export type RepoFactsMap = Map<string, RepoFacts>

export interface PublicCodeRef {
  repo: string
  private?: true
  path?: string
  description?: string
  url?: string
  permalink?: string
  license?: string | null
}

export interface PublicApp {
  slug: string
  name: string
  tagline: string
  kind: string
  url: string | null
  repo: string | null
  defaultBranch: string | null
  commit: string | null
  license: string | null
  licenseNote: string | null
  pushedAt: string | null
}

export interface PublicEntry {
  slug: string
  app: string
  title: string
  summary: string
  audiences: Audience[]
  tags: string[]
  status: PublicStatus
  access: string
  url: string | null
  docsUrl: string | null
  /** True for rows only listed under "How we run the DAO". */
  ops: boolean
  code: PublicCodeRef[]
}

export interface PublicCatalog {
  generatedAt: string
  apps: PublicApp[]
  entries: PublicEntry[]
  /** Whether GitHub facts could be read (false: visibility fell back to stored flags). */
  githubOk: boolean
}

export type SeedApp = Omit<AppRow, 'published'>
export interface SeedEntry {
  slug: string
  appSlug: string
  title: string
  summary: string
  body: string | null
  audiences: string[]
  tags: string[]
  status: string
  access: string
  toggleKey: string | null
  liveUrl: string | null
  docsUrl: string | null
  code: CodeRef[]
  position: number
}
export interface Seed {
  version: number
  apps: SeedApp[]
  entries: SeedEntry[]
}
