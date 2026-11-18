// "← Back" helper: router.back() does nothing useful when the page was opened
// directly (new tab, shared link), so fall back to an explicit route then.
//
// document.referrer is NOT updated by App Router client navigation, so in-app
// history is tracked with a sessionStorage counter that <NavTracker /> bumps on
// every client-side pathname change.

export const NAV_COUNT_KEY = "pd-inapp-nav-count";

export function recordInAppNavigation(): void {
  try {
    const n = Number(sessionStorage.getItem(NAV_COUNT_KEY)) || 0;
    sessionStorage.setItem(NAV_COUNT_KEY, String(n + 1));
  } catch {
    // storage unavailable: treated as no in-app history
  }
}

export function hasInAppHistory(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const nav = (window as unknown as { navigation?: { canGoBack?: boolean } }).navigation;
    if (nav && nav.canGoBack === false) return false;
    if (window.history.length <= 1) return false;
    return (Number(sessionStorage.getItem(NAV_COUNT_KEY)) || 0) > 0;
  } catch {
    return false;
  }
}

export function goBackOrFallback(
  router: { back: () => void; push: (href: string) => void },
  fallback: string,
): void {
  if (hasInAppHistory()) router.back();
  else router.push(fallback);
}
