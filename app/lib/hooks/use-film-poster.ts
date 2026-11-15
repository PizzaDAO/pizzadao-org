// app/lib/hooks/use-film-poster.ts
//
// sicilian-99996 — Fetch a movie poster thumbnail from Wikipedia's public
// REST API, with a module-level cache so we don't re-fetch on remount.
// Ported from the Lovable mockup (src/hooks/use-film-poster.ts).
//
// The Wikipedia REST API requires no key. If the lookup fails or returns
// no image, the consumer (FilmPoster) gracefully renders a tone-driven
// CSS composition instead.
"use client";

import { useEffect, useState } from "react";
import { FILM_WIKI_SLUG } from "@/app/lib/mafia-films";

// Module-level cache so we don't re-fetch when grids re-render or remount.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

const THUMB_WIDTH = 330;

/** Re-size a Wikipedia summary-API thumbnail URL to THUMB_WIDTH, hitting the
 * /thumb/ path directly. Already-small images (`thumbnail_unscaled`, i.e. the
 * original file is the thumbnail) are left alone: Wikimedia rejects a thumb
 * wider than the source. */
function posterThumbUrl(src: string, width?: number): string {
  if (/\/\d{2,4}px-/.test(src)) return src.replace(/\/\d{2,4}px-/, `/${THUMB_WIDTH}px-`);
  if (width && width <= THUMB_WIDTH) return src;
  const m = src.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/((?:[0-9a-f]\/[0-9a-f]{2}\/)[^/?]+)/);
  if (!m) return src;
  return `${m[1]}/thumb/${m[2]}/${THUMB_WIDTH}px-${m[2].split("/").pop()}`;
}

async function fetchPoster(slug: string): Promise<string | null> {
  if (cache.has(slug)) return cache.get(slug) ?? null;
  if (inflight.has(slug)) return inflight.get(slug)!;

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}?redirect=true`;
  const p = fetch(url, { headers: { accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (
        data: {
          originalimage?: { source?: string };
          thumbnail?: { source?: string; width?: number };
        } | null,
      ) => {
        // Prefer the API's `thumbnail` (small, direct upload.wikimedia.org URL,
        // no redirect) over `originalimage` (full-size file). Wikimedia only
        // serves standard thumbnail widths (others 429), so use 330px: enough
        // for a 200px tile at 1.5x. Files without a thumbnail are small, so
        // their original is fine.
        const upscaled = data?.thumbnail?.source
          ? posterThumbUrl(data.thumbnail.source, data.thumbnail.width)
          : data?.originalimage?.source ?? null;
        cache.set(slug, upscaled);
        return upscaled;
      },
    )
    .catch(() => {
      cache.set(slug, null);
      return null;
    })
    .finally(() => {
      inflight.delete(slug);
    });

  inflight.set(slug, p);
  return p;
}

export function useFilmPoster(filmId: string) {
  const slug = FILM_WIKI_SLUG[filmId];
  const [src, setSrc] = useState<string | null>(() =>
    slug ? (cache.get(slug) ?? null) : null,
  );
  const [loaded, setLoaded] = useState<boolean>(() =>
    Boolean(slug && cache.get(slug)),
  );

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    fetchPoster(slug).then((url) => {
      if (cancelled) return;
      setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { src, loaded, onLoaded: () => setLoaded(true) };
}
