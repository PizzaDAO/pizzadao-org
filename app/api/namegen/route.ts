// app/api/namegen/route.ts
// SIMPLIFIED: No OpenAI - pure algorithmic name generation for instant results

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type TMDBMultiSearchResult = {
  id: number;
  media_type: "movie" | "tv" | "person";
  title?: string;
  release_date?: string;
  name?: string;
  first_air_date?: string;
  overview?: string;
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
};

type TMDBCreditsCast = {
  name: string;
  character?: string;
  order?: number;
  roles?: { character?: string; episode_count?: number }[];
};

type TMDBCreditsCrew = {
  name: string;
  job?: string;
  department?: string;
};

function titleCase(s: string) {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function clampStr(s: unknown, max: number) {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) : t;
}

function normalizeTitle(s: string) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Extract first name from full name
function getFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || "";
}

/**
 * Multi-word last-name heuristic:
 * Includes common surname particles like "De", "Van", "Von", "Del", etc.
 *
 * Examples:
 * - "Robert De Niro" → "De Niro"
 * - "Jean-Claude Van Damme" → "Van Damme"
 * - "Benicio Del Toro" → "Del Toro"
 * - "Martin Scorsese" → "Scorsese"
 *
 * IMPORTANT: Do NOT include "Al"/"El" because they frequently appear as
 * first names (e.g., "Al Pacino") and would incorrectly turn the full name
 * into a "last name phrase".
 */
function getLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];

  // Surname particles that indicate multi-word last names
  const particles = new Set([
    "da",
    "de",
    "del",
    "della",
    "der",
    "di",
    "du",
    "la",
    "le",
    "st",
    "st.",
    "van",
    "von",
    "den",
    "ter",
    "bin",
    "ibn",
    // intentionally NOT including "al" / "el" - common first names
    "o'",
    "mc",
    "mac",
  ]);

  // Walk backwards from the end, collecting particles
  let i = parts.length - 1;
  const phrase: string[] = [parts[i]];
  i--;

  while (i >= 0) {
    const w = parts[i].toLowerCase();
    if (particles.has(w)) {
      phrase.unshift(parts[i]);
      i--;
      continue;
    }
    break;
  }

  return phrase.join(" ");
}

/**
 * For directors, keep everything after first name as last name phrase.
 * This allows "Francis Ford Coppola" → "Ford Coppola" instead of just "Coppola".
 */
function getDirectorLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || "";
  // Everything after first name becomes the last name phrase
  return parts.slice(1).join(" ");
}

// Clean a name part: remove non-alpha chars except hyphens/apostrophes
function cleanNamePart(s: string): string {
  return s.replace(/[^A-Za-z'-]/g, "").trim();
}

async function tmdbFetch(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("Missing TMDB_API_KEY");

  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!res.ok) throw new Error(`TMDB error ${res.status} for ${path}`);
  return res.json();
}

// Simple in-memory cache
const memCache = new Map<string, { at: number; value: any }>();
const TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function cacheGet(key: string) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    memCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: any) {
  memCache.set(key, { at: Date.now(), value });
}

// Seeded random for consistent shuffling within a request
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Iconic family names from popular mafia/crime shows and movies.
 * These should appear first in suggestions when the title matches.
 */
const ICONIC_FAMILIES: Record<string, string[]> = {
  "the sopranos": ["Soprano"],
  "sopranos": ["Soprano"],
  "the wire": ["Barksdale", "Bell", "Omar"],
  "wire": ["Barksdale", "Bell", "Omar"],
  "the godfather": ["Corleone"],
  "godfather": ["Corleone"],
  "the godfather part ii": ["Corleone"],
  "the godfather part iii": ["Corleone"],
  "goodfellas": ["Hill", "DeVito"],
  "scarface": ["Montana"],
  "boardwalk empire": ["Thompson", "Nucky"],
  "breaking bad": ["White", "Heisenberg"],
  "ozark": ["Byrde"],
  "the departed": ["Costello", "Costigan"],
  "departed": ["Costello", "Costigan"],
  "casino": ["Rothstein", "Santoro"],
  "a bronx tale": ["Calogero", "Sonny"],
  "bronx tale": ["Calogero", "Sonny"],
  "donnie brasco": ["Brasco", "Pistone"],
  "gomorrah": ["Savastano"],
  "gomorra": ["Savastano"],
  "peaky blinders": ["Shelby"],
  "the irishman": ["Sheeran", "Bufalino"],
  "irishman": ["Sheeran", "Bufalino"],
  "mob city": ["Cohen"],
  "power": ["St. Patrick", "Ghost"],
  "narcos": ["Escobar"],
  "narcos mexico": ["Gallardo"],
  "sons of anarchy": ["Teller", "Morrow"],
};

/**
 * Generate pizza mafia names algorithmically:
 * - Pattern A: "<Topping> <LastName>" (e.g., "Pepperoni Barksdale")
 * - Pattern B: "<FirstName> <Topping>" (e.g., "Omar Pepperoni")
 *
 * Uses cast names from TMDB - no AI needed!
 *
 * Prioritization:
 * 1. Iconic family names from ICONIC_FAMILIES map (if title matches)
 * 2. Remaining names in TMDB billing order (correlates with screentime)
 */
function generateNames(
  topping: string,
  castNames: { firstName: string; lastName: string; source: "actor" | "character" }[],
  excludeSet: Set<string>,
  count: number = 3,
  resolvedTitle?: string
): string[] {
  const results: string[] = [];
  const used = new Set<string>();

  // Build candidate pool: both patterns for each cast member
  // Keep them in order (TMDB billing order = screentime order)
  const candidates: string[] = [];

  for (const { firstName, lastName } of castNames) {
    const cleanFirst = cleanNamePart(firstName);
    const cleanLast = cleanNamePart(lastName);

    if (cleanLast && cleanLast.length > 1) {
      // Pattern A: "Topping LastName"
      candidates.push(`${topping} ${cleanLast}`);
    }
    if (cleanFirst && cleanFirst.length > 1) {
      // Pattern B: "FirstName Topping"
      candidates.push(`${cleanFirst} ${topping}`);
    }
  }

  // Check if we have iconic family names for this title
  const titleKey = resolvedTitle?.toLowerCase().trim() || "";
  const iconicFamilies = ICONIC_FAMILIES[titleKey] || [];

  // Partition candidates: iconic family names first, then rest in billing order
  const iconicCandidates: string[] = [];
  const otherCandidates: string[] = [];

  for (const candidate of candidates) {
    // Check if this candidate contains an iconic family name
    const isIconic = iconicFamilies.some((family) => {
      const familyLower = family.toLowerCase();
      const candidateLower = candidate.toLowerCase();
      // Check if the family name appears as a word in the candidate
      // e.g., "Pepperoni Soprano" contains "Soprano"
      return candidateLower.includes(familyLower);
    });

    if (isIconic) {
      iconicCandidates.push(candidate);
    } else {
      otherCandidates.push(candidate);
    }
  }

  // Prioritized order: iconic first, then billing order
  const prioritized = [...iconicCandidates, ...otherCandidates];

  // Pick names that aren't excluded or duplicated
  for (const name of prioritized) {
    const normalized = name.toLowerCase();
    if (!excludeSet.has(normalized) && !used.has(normalized)) {
      results.push(name);
      used.add(normalized);
      if (results.length >= count) break;
    }
  }

  return results;
}

export async function POST(req: Request) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 8000); // 8s timeout

  try {
    const body = await req.json();

    const toppingRaw = clampStr(body.topping, 80);
    const mafiaMovieTitle = clampStr(body.movieTitle, 120);
    const force = body?.force === true;

    const exclude: string[] = Array.isArray(body?.exclude) ? body.exclude : [];
    const excludeSet = new Set(
      exclude.map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean)
    );

    if (!toppingRaw || !mafiaMovieTitle) {
      clearTimeout(timeoutId);
      return NextResponse.json({ error: "Provide topping and movieTitle." }, { status: 400 });
    }

    const toppingPhrase = titleCase(toppingRaw);

    // TMDB search (multi search for movies AND TV shows)
    const search = await tmdbFetch(
      "search/multi",
      {
        query: mafiaMovieTitle,
        include_adult: "false",
        language: "en-US",
      },
      abortController.signal
    );

    // Filter to only movies and TV shows
    const results: TMDBMultiSearchResult[] = (Array.isArray(search?.results) ? search.results : [])
      .filter((r: any) => r.media_type === "movie" || r.media_type === "tv");

    const getTitle = (r: TMDBMultiSearchResult) =>
      r.media_type === "movie" ? r.title : r.name;
    const getReleaseDate = (r: TMDBMultiSearchResult) =>
      r.media_type === "movie" ? r.release_date : r.first_air_date;

    // Simple ranking: prefer exact matches, then popularity
    const inputNorm = normalizeTitle(mafiaMovieTitle);
    const ranked = results
      .map((r) => {
        const title = getTitle(r) ?? "";
        const titleNorm = normalizeTitle(title);
        const pop = typeof r.popularity === "number" ? r.popularity : 0;
        const votes = typeof r.vote_count === "number" ? r.vote_count : 0;

        const score =
          (titleNorm === inputNorm ? 10000 : 0) +
          (titleNorm.includes(inputNorm) ? 1000 : 0) +
          pop * 10 +
          Math.log10(votes + 1) * 100;

        return { ...r, _score: score };
      })
      .sort((a, b) => b._score - a._score);

    const best = ranked[0];

    if (!best?.id) {
      clearTimeout(timeoutId);
      return NextResponse.json(
        { error: `No movie or TV show found for "${mafiaMovieTitle}"` },
        { status: 404 }
      );
    }

    const mediaId = String(best.id);
    const mediaType = best.media_type;
    const resolvedTitle = getTitle(best) ?? "";
    const releaseDate = getReleaseDate(best) ?? "";

    // Check cache for TMDB credits (not final result - allows regenerate to work)
    const creditsCacheKey = `credits-v2|${mediaId}|${mediaType}`;
    let credits = cacheGet(creditsCacheKey);

    if (!credits) {
      // Fetch credits from TMDB
      const creditsPath = mediaType === "movie"
        ? `movie/${mediaId}/credits`
        : `tv/${mediaId}/aggregate_credits`;
      credits = await tmdbFetch(creditsPath, { language: "en-US" }, abortController.signal);
      cacheSet(creditsCacheKey, credits);
    }

    const cast: TMDBCreditsCast[] = Array.isArray(credits?.cast) ? credits.cast : [];
    const crew: TMDBCreditsCrew[] = Array.isArray(credits?.crew) ? credits.crew : [];

    // Extract names from cast (actors + characters) and directors
    const castNames: { firstName: string; lastName: string; source: "actor" | "character" }[] = [];

    // Add directors first (high priority)
    // For directors, keep full "last name" (e.g., "Ford Coppola" not just "Coppola")
    const directors = crew.filter((c) => c.job === "Director");
    for (const d of directors.slice(0, 5)) {
      if (d.name) {
        castNames.push({
          firstName: getFirstName(d.name),
          lastName: getDirectorLastName(d.name),
          source: "actor",
        });
      }
    }

    // Add top cast (sorted by billing order)
    const sortedCast = cast
      .slice()
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .slice(0, 30);

    for (const c of sortedCast) {
      // Actor name
      if (c.name) {
        castNames.push({
          firstName: getFirstName(c.name),
          lastName: getLastName(c.name),
          source: "actor",
        });
      }
      // Character name (handles both movie and TV formats)
      const character = c.character || c.roles?.[0]?.character || "";
      if (character && !character.includes("(") && !character.includes("/")) {
        // Skip complex character descriptions like "Self (archive footage)"
        castNames.push({
          firstName: getFirstName(character),
          lastName: getLastName(character),
          source: "character",
        });
      }
    }

    // Generate names algorithmically with iconic family prioritization
    const suggestions = generateNames(toppingPhrase, castNames, excludeSet, 3, resolvedTitle);

    // Generate a larger pool for the UI (also prioritized)
    const allNames = generateNames(toppingPhrase, castNames, new Set(), 30, resolvedTitle);

    if (suggestions.length < 3) {
      // Fallback: if we can't get 3 unique names, use what we have
      // This should be rare but prevents the "Could not generate" error
      while (suggestions.length < 3 && allNames.length > suggestions.length) {
        const next = allNames.find(n => !excludeSet.has(n.toLowerCase()) && !suggestions.includes(n));
        if (next) suggestions.push(next);
        else break;
      }
    }

    clearTimeout(timeoutId);

    const payload = {
      cached: false,
      topping: toppingPhrase,
      mafiaMovieTitle,
      resolvedMovieTitle: resolvedTitle,
      tmdbMovieId: mediaId,
      releaseDate,
      mediaType,
      style: "balanced",
      suggestions,
      candidatePool: allNames,
    };

    return new NextResponse(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": force ? "no-store" : "s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err?.name === "AbortError" || err?.message?.includes("aborted")) {
      return NextResponse.json(
        { error: "Request timed out. Please try again." },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: String(err?.message ?? "Unknown error") },
      { status: 500 }
    );
  }
}
