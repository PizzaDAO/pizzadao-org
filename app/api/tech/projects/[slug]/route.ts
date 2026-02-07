import { NextResponse } from 'next/server'
import { fetchProjectDetail } from '@/app/lib/projects/github'
import { getCached, setCache, getCacheMetadata, CACHE_KEYS } from '@/app/lib/projects/cache'
import type { ProjectDetail, ProjectsConfig } from '@/app/lib/projects/types'
import projectsConfigJson from '@/data/projects-config.json'

const projectsConfig = projectsConfigJson as ProjectsConfig

/**
 * GET /api/tech/projects/[slug]
 * Returns full detail for a single PizzaDAO project with caching
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('refresh') === 'true'
  const cacheKey = CACHE_KEYS.PROJECT_DETAIL(slug)

  try {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = getCached<ProjectDetail>(cacheKey)
      if (cached) {
        const metadata = getCacheMetadata(cacheKey)
        return NextResponse.json({
          project: cached,
          cached: true,
          ...metadata,
        })
      }
    }

    // Check if this project is excluded
    if (projectsConfig.excludeRepos.includes(slug)) {
      return NextResponse.json(
        { error: 'Project not found', message: `${slug} is excluded` },
        { status: 404 }
      )
    }

    // Fetch fresh data from GitHub
    const config = projectsConfig.projects[slug]
    const project = await fetchProjectDetail(slug, config)

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found', message: `Could not find project: ${slug}` },
        { status: 404 }
      )
    }

    // Cache the results
    setCache(cacheKey, project)
    const metadata = getCacheMetadata(cacheKey)

    return NextResponse.json({
      project,
      cached: false,
      ...metadata,
    })
  } catch (error) {
    console.error(`Error fetching project ${slug}:`, error)

    // Try to return stale cached data if available
    const staleCache = getCached<ProjectDetail>(cacheKey)
    if (staleCache) {
      return NextResponse.json({
        project: staleCache,
        cached: true,
        stale: true,
        error: 'Using stale cache due to fetch error',
      }, { status: 200 })
    }

    return NextResponse.json(
      { error: 'Failed to fetch project', message: (error as Error).message },
      { status: 500 }
    )
  }
}
