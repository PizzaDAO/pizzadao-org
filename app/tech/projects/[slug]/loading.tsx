export default function Loading() {
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
