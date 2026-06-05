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
          thumbnail?: { source?: string };
        } | null,
      ) => {
        const src =
          data?.originalimage?.source || data?.thumbnail?.source || null;
        // Upscale the thumbnail URL when possible (Wikipedia thumb pattern).
        const upscaled = src ? src.replace(/\/(\d{2,4})px-/, "/640px-") : null;
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
