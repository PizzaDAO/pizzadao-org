import { revalidatePath } from 'next/cache'

/**
 * Public pages that are prerendered and refreshed every few minutes (revalidate = 300). Call the matching
 * helper after an admin edit so the change shows at once instead of at the next timer.
 * Safe outside a request (cron, scripts, tests): a failure is swallowed and the timer heals it.
 */
export const PUBLIC_PAGES = { learn: '/learn', features: '/features', buddies: '/buddies' } as const

export function revalidatePublicPage(page: keyof typeof PUBLIC_PAGES): void {
  try {
    revalidatePath(PUBLIC_PAGES[page])
  } catch {
    // Not inside a request/server action: nothing to invalidate.
  }
}

/** The page (if any) that renders a given setting. */
export function pageForSetting(key: string): keyof typeof PUBLIC_PAGES | null {
  if (key.startsWith('education.')) return 'learn'
  if (key.startsWith('features.')) return 'features'
  if (key.startsWith('buddy.')) return 'buddies'
  return null
}

export function revalidateForSetting(key: string): void {
  const page = pageForSetting(key)
  if (page) revalidatePublicPage(page)
}
