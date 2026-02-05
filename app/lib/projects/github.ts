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
  PullRequest,
} from './types'

const GITHUB_API_BASE = 'https://api.github.com'
const ORG_NAME = 'PizzaDAO'

// Log warning once if no token is configured
let tokenWarningLogged = false

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

  // Add auth token if available (for higher rate limits: 5000/hour vs 60/hour)
  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  } else if (!tokenWarningLogged) {
    console.warn(
      '[GitHub API] No GITHUB_TOKEN configured. Using unauthenticated requests (60 req/hour limit). ' +
      'Set GITHUB_TOKEN environment variable for 5000 req/hour limit.'
    )
    tokenWarningLogged = true
  }

  return headers
}

/**
 * Handle GitHub API response and provide helpful error messages
 */
async function handleGitHubResponse<T>(response: Response, context: string): Promise<T> {
  console.log(`[GitHub API] handleGitHubResponse for ${context}, status: ${response.status}`)

  if (response.ok) {
    const text = await response.text()
    console.log(`[GitHub API] Response text length for ${context}:`, text?.length ?? 0)

    if (!text || text.trim() === '') {
      console.log(`[GitHub API] Empty response for ${context}, returning empty array`)
      return [] as unknown as T // Return empty array for empty responses
    }
    try {
      return JSON.parse(text) as T
    } catch (e) {
      console.error(`[GitHub API] Failed to parse JSON for ${context}:`, text.slice(0, 200), e)
      return [] as unknown as T
    }
  }

  // Check for rate limiting
  if (response.status === 403) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining')
    const rateLimitReset = response.headers.get('x-ratelimit-reset')

    if (rateLimitRemaining === '0' || response.statusText.toLowerCase().includes('rate limit')) {
      const resetTime = rateLimitReset
        ? new Date(parseInt(rateLimitReset) * 1000).toLocaleTimeString()
        : 'soon'

      const hasToken = !!process.env.GITHUB_TOKEN
      const tokenHint = hasToken
        ? 'Token is configured but rate limit still exceeded. Wait for reset or check token permissions.'
        : 'Configure GITHUB_TOKEN environment variable to increase limit from 60 to 5000 requests/hour.'

      throw new Error(
        `GitHub API rate limit exceeded (${context}). Resets at ${resetTime}. ${tokenHint}`
      )
    }
  }

  throw new Error(`GitHub API error (${context}): ${response.status} ${response.statusText}`)
}

/**
 * Fetch all public repositories from PizzaDAO organization
 */
export async function fetchPizzaDAORepos(): Promise<GitHubRepo[]> {
  const url = `${GITHUB_API_BASE}/orgs/${ORG_NAME}/repos?type=public&per_page=100`
  console.log('[GitHub API] Fetching repos from:', url)
  console.log('[GitHub API] Token configured:', !!process.env.GITHUB_TOKEN)

  const response = await fetch(url, { headers: getHeaders() })

  console.log('[GitHub API] Response status:', response.status, response.statusText)

  const repos = await handleGitHubResponse<GitHubRepo[]>(response, 'fetching repos')
  console.log('[GitHub API] Fetched repos count:', repos?.length ?? 0)

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
  recentPRs: PullRequest[]
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

  // Parse responses safely (handle empty responses gracefully)
  const safeParseJson = async <T>(response: Response, fallback: T): Promise<T> => {
    if (!response.ok) return fallback
    try {
      const text = await response.text()
      if (!text || text.trim() === '') return fallback
      return JSON.parse(text) as T
    } catch {
      return fallback
    }
  }

  const prs = await safeParseJson<GitHubPullRequest[]>(prsResponse, [])
  const contributorsData = await safeParseJson<GitHubContributor[]>(contributorsResponse, [])
  const commitsData = await safeParseJson<GitHubCommit[]>(commitsResponse, [])

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

  // Transform PRs (take first 3)
  const recentPRs: PullRequest[] = prs.slice(0, 3).map((pr) => {
    // Convert branch name to Vercel preview URL
    // Format: https://{project}-git-{branch}-pizza-dao.vercel.app
    const sanitizedBranch = pr.head.ref.replace(/\//g, '-').toLowerCase()
    const previewUrl = `https://${slug}-git-${sanitizedBranch}-pizza-dao.vercel.app`

    return {
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      authorAvatarUrl: pr.user.avatar_url,
      url: pr.html_url,
      branch: pr.head.ref,
      previewUrl,
      createdAt: pr.created_at,
    }
  })

  return {
    openPRs: prs.length,
    contributors,
    recentCommits,
    recentPRs,
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
): Omit<Project, 'openPRs' | 'contributors' | 'recentCommits' | 'recentPRs' | 'tasks'> {
  // Determine live URL first (needed for status)
  const liveUrl = config?.liveUrl || repo.homepage || undefined

  // Determine status - projects without a live URL are "planning" unless overridden
  let status: ProjectStatus = liveUrl ? 'active' : 'planning'
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
    liveUrl,
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
