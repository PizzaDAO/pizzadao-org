// "← Back" helper: router.back() does nothing useful when the page was opened
// directly (new tab, shared link), so fall back to an explicit route then.

export function hasInAppHistory(): boolean {
  if (typeof window === "undefined") return false;
  if (window.history.length <= 1) return false;
  try {
    const ref = document.referrer;
    return !!ref && new URL(ref).origin === window.location.origin;
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
