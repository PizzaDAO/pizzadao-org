'use client'

import type { Project, ProjectStatus } from '@/app/lib/projects/types'
import { ExternalLink, Github, GitPullRequest, AlertCircle, CircleDot, FileSpreadsheet, Eye } from 'lucide-react'
import Link from 'next/link'

/**
 * Status badge color mappings
 */
const STATUS_BADGE_CLASSES: Record<ProjectStatus, string> = {
  active: 'bg-green-500',
  maintenance: 'bg-yellow-500',
  archived: 'bg-red-500',
  planning: 'bg-blue-500',
}

/**
 * Status display labels
 */
const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  archived: 'Archived',
  planning: 'Planning',
}

/**
 * Activity level indicator colors
 */
const ACTIVITY_COLORS = {
  active: 'bg-green-400',
  stale: 'bg-yellow-400',
  dormant: 'bg-red-400',
}

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const {
    name,
    slug,
    description,
    status,
    techStack,
    activityLevel,
    githubUrl,
    liveUrl,
    sheetUrl,
    openPRs,
    openIssues,
    recentPRs,
    tasks,
    pushedAt,
  } = project

  // Format last updated date
  const lastUpdated = new Date(pushedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg transition-shadow relative">
      {/* Header with name and status */}
      <div className="flex items-start justify-between mb-3">
        <Link
          href={`/tech/projects/${slug}`}
          className="text-lg font-semibold text-gray-900 dark:text-white truncate hover:text-orange-500 transition-colors"
        >
          {name}
        </Link>
        <span
          className={`${STATUS_BADGE_CLASSES[status]} text-white text-xs font-medium px-2 py-1 rounded flex-shrink-0 ml-2`}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

      {/* Description */}
      <p className="text-gray-600 dark:text-gray-300 text-sm mb-4 line-clamp-2">
        {description || 'No description available'}
      </p>

      {/* Tech stack tags */}
      {techStack.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {techStack.map((tech) => (
            <span
              key={tech}
              className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-2 py-0.5 rounded"
            >
              {tech}
            </span>
          ))}
        </div>
      )}

      {/* Activity indicator */}
      <div
        data-testid="activity-indicator"
        className="flex items-center gap-2 mb-4 text-sm text-gray-500 dark:text-gray-400"
      >
        <span className={`w-2 h-2 rounded-full ${ACTIVITY_COLORS[activityLevel]}`} />
        <span>Last updated: {lastUpdated}</span>
      </div>

      {/* Stats row - linked to GitHub pages */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <a
          href={`${githubUrl}/pulls`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:text-orange-500 transition-colors"
        >
          <GitPullRequest className="w-4 h-4" />
          <span>{openPRs} PRs</span>
        </a>
        <a
          href={`${githubUrl}/issues`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-gray-600 dark:text-gray-400 hover:text-orange-500 transition-colors"
        >
          <AlertCircle className="w-4 h-4" />
          <span>{openIssues} Issues</span>
        </a>
      </div>

      {/* Recent PRs with GitHub links and optional Vercel Preview */}
      {recentPRs && recentPRs.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-600 pt-3 mb-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Open PRs:</p>
          <ul className="space-y-1">
            {recentPRs.map((pr) => (
              <li key={pr.number} className="text-xs flex items-center gap-1.5">
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300 hover:text-orange-500 transition-colors min-w-0"
                  title={`GitHub: ${pr.url}`}
                >
                  <CircleDot className="w-3 h-3 text-green-500 flex-shrink-0" />
                  <span className="truncate">#{pr.number} {pr.title}</span>
                </a>
                {pr.previewUrl && (
                  <a
                    href={pr.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 text-blue-500 hover:text-blue-700 transition-colors"
                    title={`Preview: ${pr.previewUrl}`}
                  >
                    <Eye className="w-3 h-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Task summary (if available) */}
      {tasks && (
        <div className="border-t border-gray-200 dark:border-gray-600 pt-3 mb-4">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500 dark:text-gray-400">
              <span className="font-medium text-blue-600">{tasks.todo}</span> To Do
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              <span className="font-medium text-yellow-600">{tasks.doing}</span> Doing
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              <span className="font-medium text-green-600">{tasks.done}</span> Done
            </span>
            {tasks.stuck > 0 && (
              <span className="text-gray-500 dark:text-gray-400">
                <span className="font-medium text-red-600">{tasks.stuck}</span> Stuck
              </span>
            )}
          </div>
        </div>
      )}

      {/* Links */}
      <div className="flex items-center gap-3">
        <a
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <Github className="w-4 h-4" />
          <span>GitHub</span>
        </a>
        {liveUrl && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Live"
            className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Live</span>
          </a>
        )}
        {sheetUrl && (
          <a
            href={sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Task Sheet"
            className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Tasks</span>
          </a>
        )}
        <Link
          href={`/tech/projects/${slug}`}
          className="flex items-center gap-1 text-sm text-orange-500 hover:text-orange-600 transition-colors ml-auto"
        >
          <span>Details</span>
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </div>
  )
}
