/**
 * Remote image hosts that next/image is allowed to optimize.
 *
 * Shared by next.config.ts (`images.remotePatterns`) and `isOptimizableImage()`
 * so components can fall back to `unoptimized` for any URL outside this list
 * (user-supplied article content, arbitrary NFT metadata hosts, etc.) instead
 * of throwing at render time.
 */

type RemotePattern = {
  protocol: "https";
  hostname: string;
  pathname?: string;
};

export const REMOTE_IMAGE_PATTERNS: RemotePattern[] = [
  // POAP artwork (POAP Compass / gallery API image_url)
  { protocol: "https", hostname: "assets.poap.xyz" },
  // Alchemy NFT media cache + thumbnails (app/lib/nft.ts)
  { protocol: "https", hostname: "nft-cdn.alchemy.com" },
  { protocol: "https", hostname: "res.cloudinary.com", pathname: "/alchemyapi/**" },
  // Vercel Blob uploads (article + suggestion images)
  { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
];

function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".public.blob.vercel-storage.com"
    return host.endsWith(suffix) && host.length > suffix.length && !host.slice(0, -suffix.length).includes(".");
  }
  return pattern === host;
}

function pathMatches(pattern: string | undefined, path: string): boolean {
  if (!pattern) return true;
  if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -2));
  return pattern === path;
}

/**
 * True when next/image can optimize `src`: a local path ("/pfp/1.jpg") or an
 * https URL on an allow-listed host. Anything else should render with
 * `unoptimized` so next/image passes it straight through.
 */
export function isOptimizableImage(src: string | null | undefined): boolean {
  if (!src) return false;
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    const u = new URL(src);
    if (u.protocol !== "https:") return false;
    return REMOTE_IMAGE_PATTERNS.some(
      (p) => hostMatches(p.hostname, u.hostname) && pathMatches(p.pathname, u.pathname),
    );
  } catch {
    return false;
  }
}
