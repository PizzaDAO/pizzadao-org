import { NextResponse } from 'next/server'
import { fetchAllProjects } from '@/app/lib/projects/github'
import { requireAdmin } from '@/app/lib/auth-guards'
import { getCached, setCache, getCacheMetadata, clearCache, CACHE_KEYS } from '@/app/lib/projects/cache'
import type { Project, ProjectsConfig } from '@/app/lib/projects/types'
import projectsConfigJson from '@/data/projects-config.json'
import { internalError } from '@/app/lib/errors/error-response'

const projectsConfig = projectsConfigJson as ProjectsConfig

/**
 * GET /api/tech/projects
 * Returns list of all PizzaDAO projects with caching
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // Only admins may bypass the cache (a refresh fans out to the GitHub API)
  const forceRefresh = searchParams.get('refresh') === 'true' && (await requireAdmin()).ok

  try {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = getCached<Project[]>(CACHE_KEYS.ALL_PROJECTS)
      if (cached) {
        const metadata = getCacheMetadata(CACHE_KEYS.ALL_PROJECTS)
        return NextResponse.json({
          projects: cached,
          cached: true,
          ...metadata,
        }, {
          headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
        })
      }
    }

    // Fetch fresh data from GitHub
    const projects = await fetchAllProjects(
      projectsConfig.projects,
      projectsConfig.excludeRepos
    )

    // Sort by last updated (most recent first)
    projects.sort((a, b) =>
      new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime()
    )

    // Cache the results
    setCache(CACHE_KEYS.ALL_PROJECTS, projects)
    const metadata = getCacheMetadata(CACHE_KEYS.ALL_PROJECTS)

    return NextResponse.json({
      projects,
      cached: false,
      ...metadata,
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
    })
  } catch (error) {
    console.error('Error fetching projects:', error)

    // Try to return cached data if available, even if expired
    const staleCache = getCached<Project[]>(CACHE_KEYS.ALL_PROJECTS)
    if (staleCache) {
      return NextResponse.json({
        projects: staleCache,
        cached: true,
        stale: true,
        error: 'Using stale cache due to fetch error',
      }, {
        status: 200,
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
      })
    }

    return internalError(error, 'tech/projects', 'Failed to fetch projects')
  }
}

/**
 * POST /api/tech/projects
 * Force refresh the cache
 */
export async function POST() {
  // Admin only: a forced refresh fans out to the GitHub API.
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response

  try {
    // Clear the cache
    clearCache(CACHE_KEYS.ALL_PROJECTS)

    // Fetch fresh data
    const projects = await fetchAllProjects(
      projectsConfig.projects,
      projectsConfig.excludeRepos
    )

    // Sort by last updated
    projects.sort((a, b) =>
      new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime()
    )

    // Cache the results
    setCache(CACHE_KEYS.ALL_PROJECTS, projects)
    const metadata = getCacheMetadata(CACHE_KEYS.ALL_PROJECTS)

    return NextResponse.json({
      success: true,
      projects,
      ...metadata,
    })
  } catch (error) {
    return internalError(error, 'tech/projects refresh', 'Failed to refresh projects')
  }
}
