'use client'

import type { Project, ProjectStatus } from '@/app/lib/projects/types'
import { ExternalLink, Github, GitPullRequest, AlertCircle } from 'lucide-react'

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
    description,
    status,
    techStack,
    activityLevel,
    githubUrl,
    liveUrl,
    openPRs,
    openIssues,
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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg transition-shadow">
      {/* Header with name and status */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
          {name}
        </h3>
        <span
          className={`${STATUS_BADGE_CLASSES[status]} text-white text-xs font-medium px-2 py-1 rounded`}
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

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <GitPullRequest className="w-4 h-4" />
          <span>{openPRs} PRs</span>
        </div>
        <div className="flex items-center gap-1 text-gray-600 dark:text-gray-400">
          <AlertCircle className="w-4 h-4" />
          <span>{openIssues} Issues</span>
        </div>
      </div>

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
      </div>
    </div>
  )
}
