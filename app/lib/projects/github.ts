/**
 * GitHub API Integration for Pizza Projects Dashboard
 */

import type {
  GitHubRepo,
  GitHubPullRequest,
  GitHubContributor,
  GitHubCommit,
  Project,
  ProjectConfig,
  ProjectStatus,
  ActivityLevel,
  Contributor,
  Commit,
} from './types'

const GITHUB_API_BASE = 'https://api.github.com'
const ORG_NAME = 'PizzaDAO'

/**
 * Tech stack detection mappings
 */
const TECH_STACK_MAPPINGS: Record<string, string> = {
  // Languages
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  solidity: 'Solidity',
  rust: 'Rust',
  go: 'Go',

  // Frameworks from topics
  nextjs: 'Next.js',
  'next-js': 'Next.js',
  react: 'React',
  vue: 'Vue',
  angular: 'Angular',
  svelte: 'Svelte',
  express: 'Express',
  fastify: 'Fastify',

  // Blockchain
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  hardhat: 'Hardhat',
  foundry: 'Foundry',
  web3: 'Web3',
  wagmi: 'Wagmi',

  // Databases
  postgresql: 'PostgreSQL',
  postgres: 'PostgreSQL',
  supabase: 'Supabase',
  prisma: 'Prisma',
  mongodb: 'MongoDB',

  // CSS/Styling
  tailwindcss: 'Tailwind CSS',
  tailwind: 'Tailwind CSS',
}

/**
 * Get GitHub API headers
 */
function getHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'PizzaDAO-Projects-Dashboard',
  }

  // Add auth token if available (for higher rate limits)
  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

/**
 * Fetch all public repositories from PizzaDAO organization
 */
export async function fetchPizzaDAORepos(): Promise<GitHubRepo[]> {
  const response = await fetch(
    `${GITHUB_API_BASE}/orgs/${ORG_NAME}/repos?type=public&per_page=100`,
    { headers: getHeaders() }
  )

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }

  const repos: GitHubRepo[] = await response.json()

  // Filter out forked repositories
  return repos.filter((repo) => !repo.fork)
}

/**
 * Fetch detailed information for a specific repository
 */
export async function fetchRepoDetails(slug: string): Promise<{
  openPRs: number
  contributors: Contributor[]
  recentCommits: Commit[]
}> {
  const headers = getHeaders()

  // Fetch all details in parallel
  const [prsResponse, contributorsResponse, commitsResponse] = await Promise.all([
    fetch(`${GITHUB_API_BASE}/repos/${ORG_NAME}/${slug}/pulls?state=open&per_page=10`, {
      headers,
    }),
    fetch(`${GITHUB_API_BASE}/repos/${ORG_NAME}/${slug}/contributors?per_page=10`, {
      headers,
    }),
    fetch(`${GITHUB_API_BASE}/repos/${ORG_NAME}/${slug}/commits?per_page=10`, {
      headers,
    }),
  ])

  // Parse responses (handle potential failures gracefully)
  const prs: GitHubPullRequest[] = prsResponse.ok ? await prsResponse.json() : []
  const contributorsData: GitHubContributor[] = contributorsResponse.ok
    ? await contributorsResponse.json()
    : []
  const commitsData: GitHubCommit[] = commitsResponse.ok ? await commitsResponse.json() : []

  // Transform contributors
  const contributors: Contributor[] = contributorsData.map((c) => ({
    login: c.login,
    avatarUrl: c.avatar_url,
    contributions: c.contributions,
    profileUrl: c.html_url,
  }))

  // Transform commits
  const recentCommits: Commit[] = commitsData.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.author?.login || c.commit.author.name,
    authorAvatarUrl: c.author?.avatar_url || '',
    date: c.commit.author.date,
    url: c.html_url,
  }))

  return {
    openPRs: prs.length,
    contributors,
    recentCommits,
  }
}

/**
 * Detect tech stack from repository metadata
 */
export function detectTechStack(repo: GitHubRepo): string[] {
  const techStack: Set<string> = new Set()

  // Add primary language
  if (repo.language) {
    const normalizedLang = repo.language.toLowerCase()
    const mappedLang = TECH_STACK_MAPPINGS[normalizedLang]
    if (mappedLang) {
      techStack.add(mappedLang)
    } else {
      techStack.add(repo.language)
    }
  }

  // Add from topics
  for (const topic of repo.topics) {
    const normalizedTopic = topic.toLowerCase()
    const mappedTech = TECH_STACK_MAPPINGS[normalizedTopic]
    if (mappedTech) {
      techStack.add(mappedTech)
    }
  }

  return Array.from(techStack)
}

/**
 * Calculate activity level based on last push date
 */
export function calculateActivityLevel(pushedAt: string): ActivityLevel {
  const lastPush = new Date(pushedAt)
  const now = new Date()
  const daysSinceLastPush = Math.floor(
    (now.getTime() - lastPush.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (daysSinceLastPush <= 30) {
    return 'active'
  } else if (daysSinceLastPush <= 90) {
    return 'stale'
  } else {
    return 'dormant'
  }
}

/**
 * Transform GitHub repo response to Project interface
 */
export function transformGitHubRepo(
  repo: GitHubRepo,
  config?: ProjectConfig
): Omit<Project, 'openPRs' | 'contributors' | 'recentCommits' | 'tasks'> {
  // Determine status
  let status: ProjectStatus = 'active'
  if (repo.archived) {
    status = 'archived'
  } else if (config?.status) {
    status = config.status
  }

  return {
    name: repo.name,
    slug: repo.name,
    description: repo.description,
    githubUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    techStack: detectTechStack(repo),
    activityLevel: calculateActivityLevel(repo.pushed_at),
    status,
    liveUrl: config?.liveUrl,
    vercelProject: config?.vercelProject,
    sheetUrl: config?.sheetUrl,
    openIssues: repo.open_issues_count,
  }
}

/**
 * Fetch all projects with full details
 */
export async function fetchAllProjects(
  config?: Record<string, ProjectConfig>,
  excludeRepos: string[] = []
): Promise<Project[]> {
  // Get all repos
  const repos = await fetchPizzaDAORepos()

  // Filter excluded repos
  const filteredRepos = repos.filter((repo) => !excludeRepos.includes(repo.name))

  // Transform and fetch details for each repo
  const projects = await Promise.all(
    filteredRepos.map(async (repo) => {
      const baseProject = transformGitHubRepo(repo, config?.[repo.name])
      const details = await fetchRepoDetails(repo.name)

      return {
        ...baseProject,
        ...details,
      } as Project
    })
  )

  return projects
}
