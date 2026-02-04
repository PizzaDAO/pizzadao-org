'use client'

import type { Project } from '@/app/lib/projects/types'
import { ProjectCard } from './ProjectCard'
import { FolderOpen } from 'lucide-react'

interface ProjectGridProps {
  projects: Project[]
  loading?: boolean
}

/**
 * Skeleton card for loading state
 */
function ProjectSkeleton() {
  return (
    <div
      data-testid="project-skeleton"
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-5 animate-pulse"
    >
      {/* Header skeleton */}
      <div className="flex items-start justify-between mb-3">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-32" />
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16" />
      </div>

      {/* Description skeleton */}
      <div className="space-y-2 mb-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
      </div>

      {/* Tech stack skeleton */}
      <div className="flex gap-2 mb-4">
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-20" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-14" />
      </div>

      {/* Activity skeleton */}
      <div className="flex items-center gap-2 mb-4">
        <div className="h-2 w-2 bg-gray-200 dark:bg-gray-700 rounded-full" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
      </div>

      {/* Stats skeleton */}
      <div className="flex items-center gap-4 mb-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
      </div>

      {/* Links skeleton */}
      <div className="flex items-center gap-3">
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-12" />
      </div>
    </div>
  )
}

/**
 * Empty state component
 */
function EmptyState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
      <FolderOpen className="w-16 h-16 text-gray-400 dark:text-gray-600 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
        No Projects Found
      </h3>
      <p className="text-gray-500 dark:text-gray-400 max-w-md">
        There are no projects to display. Check back later or adjust your filters.
      </p>
    </div>
  )
}

export function ProjectGrid({ projects, loading = false }: ProjectGridProps) {
  // Show loading skeletons
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <ProjectSkeleton key={index} />
        ))}
      </div>
    )
  }

  // Show empty state
  if (projects.length === 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <EmptyState />
      </div>
    )
  }

  // Render project cards
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {projects.map((project) => (
        <ProjectCard key={project.slug} project={project} />
      ))}
    </div>
  )
}
