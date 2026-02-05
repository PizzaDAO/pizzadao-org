/**
 * Loading skeleton for projects page
 * Shown while the page is loading via Next.js Suspense
 */
export default function ProjectsLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header skeleton */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-64 animate-pulse" />
            <div className="mt-2 h-5 bg-gray-200 dark:bg-gray-700 rounded w-96 animate-pulse" />
          </div>
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-28 animate-pulse" />
        </div>

        {/* Grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
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
          ))}
        </div>
      </div>
    </div>
  )
}
