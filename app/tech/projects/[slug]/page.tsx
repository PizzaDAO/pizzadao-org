'use client'

import { useState, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import type { ProjectDetail, ProjectStatus } from '@/app/lib/projects/types'
import {
  ArrowLeft,
  RefreshCw,
  Github,
  ExternalLink,
  FileSpreadsheet,
  GitPullRequest,
  AlertCircle,
  Users,
  GitCommit,
  Eye,
  MessageSquare,
} from 'lucide-react'

/**
 * Status badge color mappings
 */
const STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  active: 'bg-green-500',
  maintenance: 'bg-yellow-500',
  archived: 'bg-red-500',
  planning: 'bg-blue-500',
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  archived: 'Archived',
  planning: 'Planning',
}

const ACTIVITY_COLORS = {
  active: 'bg-green-400',
  stale: 'bg-yellow-400',
  dormant: 'bg-red-400',
}

/**
 * Format a date string into a relative time like "3 days ago"
 */
function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProjectDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetchProject = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      const url = forceRefresh
        ? `/api/tech/projects/${slug}?refresh=true`
        : `/api/tech/projects/${slug}`

      const response = await fetch(url)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch project')
      }

      setProject(data.project)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [slug])

  useEffect(() => {
    fetchProject()
  }, [fetchProject])

  const handleRefresh = () => {
    fetchProject(true)
  }

  if (loading) {
    return <ProjectDetailSkeleton />
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link
            href="/tech/projects"
            className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-orange-500 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Projects
          </Link>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Project Not Found</h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">{error || 'Could not load project data'}</p>
            <button
              onClick={() => fetchProject()}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <Link
          href="/tech/projects"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-orange-500 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </Link>

        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{project.name}</h1>
                <span className={`${STATUS_BADGE_CLASSES[project.status]} text-white text-xs font-medium px-2.5 py-1 rounded`}>
                  {STATUS_LABELS[project.status]}
                </span>
                <span className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                  <span className={`w-2 h-2 rounded-full ${ACTIVITY_COLORS[project.activityLevel]}`} />
                  {project.activityLevel}
                </span>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-3">
                {project.description || 'No description available'}
              </p>
              {/* Tech stack */}
              {project.techStack.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {project.techStack.map((tech) => (
                    <span
                      key={tech}
                      className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-2 py-0.5 rounded"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-lg transition-colors flex-shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>

          {/* Action links */}
          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-600">
            <a
              href={project.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <Github className="w-4 h-4" />
              GitHub
            </a>
            {project.liveUrl && (
              <a
                href={project.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Live Site
              </a>
            )}
            {project.sheetUrl && (
              <a
                href={project.sheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Task Sheet
              </a>
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
            <div className="flex items-center gap-1.5 text-sm">
              <GitPullRequest className="w-4 h-4 text-green-500" />
              <span className="font-medium text-gray-900 dark:text-white">{project.allPRs?.length ?? project.openPRs}</span>
              <span className="text-gray-500 dark:text-gray-400">Open PRs</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <AlertCircle className="w-4 h-4 text-yellow-500" />
              <span className="font-medium text-gray-900 dark:text-white">{project.issues?.length ?? project.openIssues}</span>
              <span className="text-gray-500 dark:text-gray-400">Open Issues</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Users className="w-4 h-4 text-blue-500" />
              <span className="font-medium text-gray-900 dark:text-white">{project.contributors.length}</span>
              <span className="text-gray-500 dark:text-gray-400">Contributors</span>
            </div>
          </div>
        </div>

        {/* Open Pull Requests */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <GitPullRequest className="w-5 h-5 text-green-500" />
            Open Pull Requests ({project.allPRs?.length ?? 0})
          </h2>
          {project.allPRs && project.allPRs.length > 0 ? (
            <div className="space-y-3">
              {project.allPRs.map((pr) => (
                <div
                  key={pr.number}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <img
                    src={pr.authorAvatarUrl}
                    alt={pr.author}
                    className="w-8 h-8 rounded-full flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        href={pr.previewUrl || pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 dark:text-white hover:text-orange-500 transition-colors truncate"
                      >
                        #{pr.number} {pr.title}
                      </a>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                      <span>{pr.author}</span>
                      <span className="font-mono bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded text-xs">
                        {pr.branch}
                      </span>
                      <span>{timeAgo(pr.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors px-2 py-1 rounded bg-gray-100 dark:bg-gray-600"
                    >
                      <Github className="w-3 h-3" />
                      GitHub
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No open pull requests</p>
          )}
        </div>

        {/* Open Issues */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-500" />
            Open Issues ({project.issues?.length ?? 0})
          </h2>
          {project.issues && project.issues.length > 0 ? (
            <div className="space-y-3">
              {project.issues.map((issue) => (
                <div
                  key={issue.number}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <img
                    src={issue.authorAvatarUrl}
                    alt={issue.author}
                    className="w-8 h-8 rounded-full flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 dark:text-white hover:text-orange-500 transition-colors"
                      >
                        #{issue.number} {issue.title}
                      </a>
                      {issue.labels.map((label) => (
                        <span
                          key={label.name}
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: `#${label.color}20`,
                            color: `#${label.color}`,
                            border: `1px solid #${label.color}40`,
                          }}
                        >
                          {label.name}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                      <span>{issue.author}</span>
                      <span>{timeAgo(issue.createdAt)}</span>
                      {issue.commentCount > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {issue.commentCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No open issues</p>
          )}
        </div>

        {/* Contributors */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            Contributors ({project.contributors.length})
          </h2>
          {project.contributors.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {project.contributors.map((contributor) => (
                <a
                  key={contributor.login}
                  href={contributor.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title={`${contributor.login} (${contributor.contributions} contributions)`}
                >
                  <img
                    src={contributor.avatarUrl}
                    alt={contributor.login}
                    className="w-8 h-8 rounded-full"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{contributor.login}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{contributor.contributions} commits</div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No contributor data available</p>
          )}
        </div>

        {/* Recent Commits */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <GitCommit className="w-5 h-5 text-purple-500" />
            Recent Commits ({project.recentCommits.length})
          </h2>
          {project.recentCommits.length > 0 ? (
            <div className="space-y-3">
              {project.recentCommits.map((commit) => (
                <div
                  key={commit.sha}
                  className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                >
                  {commit.authorAvatarUrl ? (
                    <img
                      src={commit.authorAvatarUrl}
                      alt={commit.author}
                      className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <a
                      href={commit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gray-900 dark:text-white hover:text-orange-500 transition-colors line-clamp-1"
                    >
                      {commit.message.split('\n')[0]}
                    </a>
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
                      <span>{commit.author}</span>
                      <span className="font-mono">{commit.sha.slice(0, 7)}</span>
                      <span>{timeAgo(commit.date)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-sm">No recent commits</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Loading skeleton for the detail page
 */
function ProjectDetailSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link skeleton */}
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-6 animate-pulse" />

        {/* Header skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6 animate-pulse">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48" />
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              </div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-3" />
              <div className="flex gap-2">
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16" />
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-20" />
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-14" />
              </div>
            </div>
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-24" />
          </div>
          <div className="pt-4 border-t border-gray-200 dark:border-gray-600">
            <div className="flex gap-4">
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-20" />
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-20" />
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-24" />
            </div>
          </div>
          <div className="flex gap-6 mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-24" />
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-24" />
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-28" />
          </div>
        </div>

        {/* PRs skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6 animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-4" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 mb-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded-full" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>

        {/* Issues skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6 animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-40 mb-4" />
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 mb-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded-full" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-2/3 mb-2" />
                <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>

        {/* Contributors skeleton */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6 animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-36 mb-4" />
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded-full" />
                <div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-20 mb-1" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
