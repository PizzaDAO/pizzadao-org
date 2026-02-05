/**
 * Project Types for Pizza Projects Dashboard
 */

/**
 * Project status indicating the current state of the project
 */
export type ProjectStatus = 'active' | 'maintenance' | 'archived' | 'planning'

/**
 * Activity level based on recent commit frequency
 */
export type ActivityLevel = 'active' | 'stale' | 'dormant'

/**
 * Contributor information from GitHub
 */
export interface Contributor {
  login: string
  avatarUrl: string
  contributions: number
  profileUrl: string
}

/**
 * Commit information from GitHub
 */
export interface Commit {
  sha: string
  message: string
  author: string
  authorAvatarUrl: string
  date: string
  url: string
}

/**
 * Pull request information from GitHub
 */
export interface PullRequest {
  number: number
  title: string
  author: string
  authorAvatarUrl: string
  url: string
  branch: string
  previewUrl: string
  createdAt: string
}

/**
 * Task summary from sheets-claude
 */
export interface TaskSummary {
  todo: number
  doing: number
  done: number
  stuck: number
  topPriority: Task[]
}

/**
 * Individual task from sheets-claude
 */
export interface Task {
  id: string
  name: string
  stage: string
  priority: string
  leadId?: string
  lead?: string
  notes?: string
  tags?: string[]
}

/**
 * Project configuration overrides (from projects-config.json)
 */
export interface ProjectConfig {
  status?: ProjectStatus
  liveUrl?: string
  vercelProject?: string
  sheetUrl?: string
  description?: string
}

/**
 * Main Project interface combining all data sources
 */
export interface Project {
  // From GitHub
  name: string
  slug: string
  description: string | null
  githubUrl: string
  defaultBranch: string
  createdAt: string
  updatedAt: string
  pushedAt: string

  // Computed/detected
  techStack: string[]
  activityLevel: ActivityLevel

  // From config overrides
  status: ProjectStatus
  liveUrl?: string
  vercelProject?: string
  sheetUrl?: string

  // From GitHub API
  openPRs: number
  openIssues: number
  contributors: Contributor[]
  recentCommits: Commit[]
  recentPRs: PullRequest[]

  // From sheets-claude (optional)
  tasks?: TaskSummary
}

/**
 * GitHub repository response (simplified)
 */
export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  description: string | null
  html_url: string
  homepage: string | null
  default_branch: string
  created_at: string
  updated_at: string
  pushed_at: string
  open_issues_count: number
  language: string | null
  topics: string[]
  archived: boolean
  fork: boolean
}

/**
 * GitHub pull request response (simplified)
 */
export interface GitHubPullRequest {
  id: number
  number: number
  title: string
  state: string
  html_url: string
  user: {
    login: string
    avatar_url: string
  }
  head: {
    ref: string
  }
  created_at: string
  updated_at: string
}

/**
 * GitHub contributor response (simplified)
 */
export interface GitHubContributor {
  login: string
  avatar_url: string
  contributions: number
  html_url: string
}

/**
 * GitHub commit response (simplified)
 */
export interface GitHubCommit {
  sha: string
  commit: {
    message: string
    author: {
      name: string
      date: string
    }
  }
  author: {
    login: string
    avatar_url: string
  } | null
  html_url: string
}

/**
 * Projects config file structure
 */
export interface ProjectsConfig {
  projects: Record<string, ProjectConfig>
  excludeRepos: string[]
}

/**
 * API response for projects list
 */
export interface ProjectsApiResponse {
  projects: Project[]
  cachedAt: string
  expiresAt: string
}

/**
 * Status badge colors
 */
export const STATUS_COLORS: Record<ProjectStatus, string> = {
  active: 'bg-green-500',
  maintenance: 'bg-yellow-500',
  archived: 'bg-red-500',
  planning: 'bg-blue-500',
}

/**
 * Activity level thresholds (in days)
 */
export const ACTIVITY_THRESHOLDS = {
  active: 30,   // Updated within 30 days
  stale: 90,    // Updated between 30-90 days
  dormant: 90,  // Not updated for 90+ days
}
