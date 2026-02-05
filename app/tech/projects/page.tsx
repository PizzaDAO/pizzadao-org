'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ProjectGrid } from '@/components/projects/ProjectGrid'
import type { Project } from '@/app/lib/projects/types'
import { RefreshCw, ArrowLeft } from 'lucide-react'

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [cacheInfo, setCacheInfo] = useState<{ cachedAt?: string; expiresAt?: string }>({})

  const fetchProjects = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      const url = forceRefresh
        ? '/api/tech/projects?refresh=true'
        : '/api/tech/projects'

      const response = await fetch(url)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch projects')
      }

      setProjects(data.projects)
      setCacheInfo({
        cachedAt: data.cachedAt,
        expiresAt: data.expiresAt,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleRefresh = () => {
    fetchProjects(true)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <Link
          href="/crew/tech"
          className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-orange-500 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Tech Crew
        </Link>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              PizzaDAO Projects
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              All open source projects from the PizzaDAO organization
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>

        {/* Cache info */}
        {cacheInfo.cachedAt && (
          <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            Last updated: {new Date(cacheInfo.cachedAt).toLocaleString()}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-700 dark:text-red-400">
              Error loading projects: {error}
            </p>
            <button
              onClick={() => fetchProjects()}
              className="mt-2 text-red-600 dark:text-red-400 underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Project grid */}
        <ProjectGrid projects={projects} loading={loading} />

        {/* Stats footer */}
        {!loading && projects.length > 0 && (
          <div className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Showing {projects.length} project{projects.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
