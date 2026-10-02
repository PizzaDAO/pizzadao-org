// app/lib/blob-url.ts
// Validate that a URL points at *our* Vercel Blob store, so user-supplied
// image URLs (e.g. suggestions.imageUrl) can't be arbitrary third-party links.

const BLOB_PUBLIC_SUFFIX = ".public.blob.vercel-storage.com";

/**
 * Hostname of our Blob store, derived from BLOB_READ_WRITE_TOKEN
 * (format: vercel_blob_rw_<storeId>_<secret>). Returns null if unknown.
 */
export function getOwnBlobHost(token = process.env.BLOB_READ_WRITE_TOKEN): string | null {
  const match = token?.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  if (!match) return null;
  return `${match[1].toLowerCase()}${BLOB_PUBLIC_SUFFIX}`;
}

/**
 * True if `url` is an https URL on our Blob store (or, if the store can't be
 * determined from env, any Vercel Blob public host) under `pathPrefix`.
 */
export function isOwnBlobUrl(url: string, pathPrefix = "/"): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  const own = getOwnBlobHost();
  const hostOk = own ? host === own : host.endsWith(BLOB_PUBLIC_SUFFIX);
  if (!hostOk) return false;
  return parsed.pathname.startsWith(pathPrefix);
}
