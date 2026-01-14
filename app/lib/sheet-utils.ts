/**
 * Utility functions for working with Google Sheets via Apps Script Web Apps
 */

/**
 * Fetch with redirect handling for Apps Script
 * Apps Script returns 302 redirects that need to be followed
 */
export async function fetchWithRedirect(
  url: string,
  payload: any,
  maxRedirects = 3
): Promise<{ status: number; text: string }> {
  // First request is POST with the payload
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "manual",
  });

  // If not a redirect, return directly
  if (res.status !== 302 && res.status !== 301) {
    const text = await res.text();
    return { status: res.status, text };
  }

  // Follow redirects with GET (Apps Script redirect pattern)
  let currentUrl: string | null = res.headers.get("location");
  if (!currentUrl) {
    return { status: res.status, text: "Redirect without location" };
  }

  for (let i = 0; i < maxRedirects; i++) {
    const redirectRes: Response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
    });

    if (redirectRes.status === 302 || redirectRes.status === 301) {
      const location = redirectRes.headers.get("location");
      if (!location) {
        return { status: redirectRes.status, text: "Redirect without location" };
      }
      currentUrl = location;
      continue;
    }

    const text = await redirectRes.text();
    return { status: redirectRes.status, text };
  }
  return { status: 500, text: "Too many redirects" };
}

/**
 * Find a column index from header values using multiple aliases
 * Returns the index of the first matching alias, or defaultValue if none match
 * Normalizes headers to lowercase and handles different spacing/punctuation
 */
export function findColumnIndex(
  headers: string[],
  aliases: string[],
  defaultValue: number | null = null
): number | null {
  const normalizedHeaders = headers.map((h) =>
    String(h).toLowerCase().replace(/[#\s\-_]+/g, "")
  );
  const normalizedAliases = aliases.map((a) =>
    String(a).toLowerCase().replace(/[#\s\-_]+/g, "")
  );

  for (let i = 0; i < normalizedHeaders.length; i++) {
    if (normalizedAliases.includes(normalizedHeaders[i])) {
      return i;
    }
  }

  return defaultValue;
}
