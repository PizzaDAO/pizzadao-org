// app/api/namegen/route.ts
import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Use faster timeout for OpenAI calls
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 2500, // 2.5s timeout for OpenAI calls
});

// Overall request timeout (3 seconds max)
const REQUEST_TIMEOUT_MS = 3000;

type TMDBSearchResult = {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
};

type TMDBMultiSearchResult = {
  id: number;
  media_type: "movie" | "tv" | "person";
  // Movie fields
  title?: string;
  release_date?: string;
  // TV fields
  name?: string;
  first_air_date?: string;
  // Common fields
  overview?: string;
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
};

type TMDBCreditsCast = {
  name: string;
  character?: string;
  order?: number;
  // TV aggregate_credits has roles array instead of single character
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

function normalizeSpaces(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

// ✅ normalize spacing but preserve original capitalization (for names)
function normalizeNamePreserveCase(s: string) {
  return normalizeSpaces(String(s ?? ""));
}

function sanitizeNameKeepSpaces(s: string) {
  // keep spaces, hyphens, apostrophes; remove other punctuation
  return normalizeSpaces(String(s ?? "")).replace(/[^A-Za-z\s'-]/g, "");
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitWords(full: string) {
  return normalizeSpaces(full).split(" ").filter(Boolean);
}

/**
 * Multi-word last-name heuristic:
 * - Include common surname particles like "De", "Van", "Von", etc.
 * - IMPORTANT: Do NOT include tokens like "Al"/"El" because they frequently
 *   appear as first names (e.g., "Al Pacino") and would incorrectly turn
 *   the full name into a "last name phrase".
 */
function detectLastNamePhrase(fullName: string): string {
  const parts = splitWords(fullName);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];

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
    // intentionally NOT including "al" / "el"
    "o'",
    "mc",
    "mac",
  ]);

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

function detectFirstNamePhrase(fullName: string): string {
  const parts = splitWords(fullName);
  if (parts.length === 0) return "";
  return parts[0];
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

// In-memory cache (local/dev friendly)
const memCache = new Map<string, { at: number; value: any }>();
const TTL_MS = 1000 * 60 * 60 * 24 * 7;

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

/**
 * In-flight dedupe:
 * Prevents users from firing multiple OpenAI calls by repeatedly clicking
 * Generate/Regenerate while an identical request is already running.
 */
const inflight = new Map<string, Promise<any>>();

/**
 * Local RPM gate (best-effort):
 * If you're on a tiny RPM limit (like 3 RPM), fail fast with Retry-After
 * instead of calling OpenAI and getting a raw 429.
 *
 * NOTE: This is per-process. In serverless with multiple instances, it's not
 * a global limiter, but it helps a lot in dev/single-instance deployments.
 */
const rpmWindow: number[] = [];
const RPM_LIMIT = 3;
const WINDOW_MS = 60_000;

function checkLocalRpmOrThrow() {
  const now = Date.now();
  while (rpmWindow.length && now - rpmWindow[0] > WINDOW_MS) rpmWindow.shift();
  if (rpmWindow.length >= RPM_LIMIT) {
    const retryMs = WINDOW_MS - (now - rpmWindow[0]);
    const retryAfter = Math.max(1, Math.ceil(retryMs / 1000));
    const e: any = new Error("Local RPM limit hit");
    e.status = 429;
    e.retryAfter = retryAfter;
    throw e;
  }
  rpmWindow.push(now);
}

function isRateLimitError(err: any) {
  const status = err?.status ?? err?.response?.status;
  const msg = String(err?.message ?? "").toLowerCase();
  return status === 429 || msg.includes("rate limit") || msg.includes("429");
}

/**
 * Minimal retry/backoff for OpenAI 429s.
 */
async function callOpenAIWithBackoff<T>(fn: () => Promise<T>, tries = 3) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      if (!isRateLimitError(e) || i === tries - 1) throw e;

      // exponential backoff + jitter
      const delay = Math.min(3000, 300 * 2 ** i) + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * RULE MODEL:
 * - Name is exactly TWO PARTS (two chunks):
 *   1) topping phrase (can be multiword, e.g. "Green Pepper")
 *   2) cast name phrase (can be multiword, e.g. "De Niro")
 *
 * Valid forms:
 *   A) "<TOPPING> <LASTNAME_PHRASE>"
 *   B) "<FIRSTNAME_PHRASE> <TOPPING>"
 *
 * Where:
 * - lastname phrase must be from actor/character last-name phrases
 * - firstname phrase must be from actor/character first-name phrases
 *
 * IMPORTANT:
 * - Preserve capitalization for cast phrases (LaBeouf stays LaBeouf)
 * - Only normalize whitespace for matching
 */
function buildFilterAndReranker(
  toppingPhraseRaw: string,
  topCast: Array<{
    actorFirstPhrase: string;
    actorLastPhrase: string;
    characterFirstPhrase: string;
    characterLastPhrase: string;
    castOrder: number;
  }>,
  style: "balanced" | "serious" | "goofy"
) {
  const toppingPhrase = titleCase(toppingPhraseRaw);
  const toppingLower = toppingPhrase.toLowerCase();

  const firstPhrases = new Set(
    topCast
      .flatMap((c) => [c.actorFirstPhrase, c.characterFirstPhrase])
      .map((x) => normalizeNamePreserveCase(x))
      .filter(Boolean)
  );

  const lastPhrases = new Set(
    topCast
      .flatMap((c) => [c.actorLastPhrase, c.characterLastPhrase])
      .map((x) => normalizeNamePreserveCase(x))
      .filter(Boolean)
  );

  // Order maps (use normalized spacing, preserve case)
  const firstToOrder = new Map<string, number>();
  const lastToOrder = new Map<string, number>();

  for (const c of topCast) {
    const af = normalizeNamePreserveCase(c.actorFirstPhrase);
    const cf = normalizeNamePreserveCase(c.characterFirstPhrase);
    const al = normalizeNamePreserveCase(c.actorLastPhrase);
    const cl = normalizeNamePreserveCase(c.characterLastPhrase);

    if (af && !firstToOrder.has(af)) firstToOrder.set(af, c.castOrder);
    if (cf && !firstToOrder.has(cf)) firstToOrder.set(cf, c.castOrder);

    if (al && !lastToOrder.has(al)) lastToOrder.set(al, c.castOrder);
    if (cl && !lastToOrder.has(cl)) lastToOrder.set(cl, c.castOrder);
  }

  // Match exact two-part patterns (case-insensitive, space-normalized)
  const topEsc = escapeRegex(toppingPhrase);
  const reToppingLast = new RegExp(`^${topEsc}\\s+(.+)$`, "i");
  const reFirstTopping = new RegExp(`^(.+)\\s+${topEsc}$`, "i");

  function isAllowed(name: string) {
    const nRaw = sanitizeNameKeepSpaces(name);
    const n = normalizeSpaces(nRaw);
    if (!n) return false;

    const lower = n.toLowerCase();

    // "<TOPPING> <LASTNAME_PHRASE>"
    if (lower.startsWith(toppingLower + " ")) {
      const m = n.match(reToppingLast);
      if (!m) return false;
      const last = normalizeNamePreserveCase(m[1]);
      return lastPhrases.has(last);
    }

    // "<FIRSTNAME_PHRASE> <TOPPING>"
    if (lower.endsWith(" " + toppingLower)) {
      const m = n.match(reFirstTopping);
      if (!m) return false;
      const first = normalizeNamePreserveCase(m[1]);
      return firstPhrases.has(first);
    }

    return false;
  }

  function score(name: string) {
    const n = normalizeSpaces(sanitizeNameKeepSpaces(name));
    const lower = n.toLowerCase();

    const toppingIsFirst = lower.startsWith(toppingLower + " ");
    const toppingIsLast = lower.endsWith(" " + toppingLower);

    // Extract the non-topping phrase (preserve capitalization from candidate)
    let nonPhrase = "";
    if (toppingIsFirst) nonPhrase = normalizeNamePreserveCase(n.replace(reToppingLast, "$1"));
    else if (toppingIsLast) nonPhrase = normalizeNamePreserveCase(n.replace(reFirstTopping, "$1"));

    // If topping is last => nonPhrase is FIRSTNAME_PHRASE (use firstToOrder)
    // else => nonPhrase is LASTNAME_PHRASE (use lastToOrder)
    const order = toppingIsLast ? firstToOrder.get(nonPhrase) : lastToOrder.get(nonPhrase);
    const orderBonus = order == null ? 0 : Math.max(0, 40 - order * 3);

    let s = 0;

    // Pattern preference:
    // "FirstName Topping" reads nickname-y; "Topping LastName" reads mafia-ish
    if (toppingIsLast) s += style === "serious" ? 18 : style === "goofy" ? 34 : 26; // First Topping
    else s += style === "serious" ? 28 : style === "goofy" ? 20 : 24; // Topping Last

    // Cast prominence bonus
    s += orderBonus;

    // Small adjustments
    if (style === "serious") {
      if (nonPhrase.length >= 7) s += 6;
    }
    if (style === "goofy") {
      if (nonPhrase.length <= 6) s += 4;
    }

    return s;
  }

  function rerank(list: string[]) {
    const uniq = Array.from(
      new Set(list.map((x) => normalizeSpaces(sanitizeNameKeepSpaces(x))))
    ).filter(Boolean);

    const filtered = uniq.filter(isAllowed);
    filtered.sort((x, y) => score(y) - score(x));
    return filtered;
  }

  return { rerank };
}

export async function POST(req: Request) {
  // Create abort controller for overall timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const body = await req.json();

    const toppingRaw = clampStr(body.topping, 80);
    const mafiaMovieTitle = clampStr(body.movieTitle, 120);
    // Always use "balanced" style (vibe dropdown removed)
    const style: "balanced" | "serious" | "goofy" = "balanced";

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
    const search = await tmdbFetch("search/multi", {
      query: mafiaMovieTitle,
      include_adult: "false",
      language: "en-US",
    }, abortController.signal);

    // Filter to only movies and TV shows (exclude person results)
    const results: TMDBMultiSearchResult[] = (Array.isArray(search?.results) ? search.results : [])
      .filter((r: any) => r.media_type === "movie" || r.media_type === "tv");

    // Helper to normalize field access for movies vs TV shows
    const getTitle = (r: TMDBMultiSearchResult) =>
      r.media_type === "movie" ? r.title : r.name;
    const getReleaseDate = (r: TMDBMultiSearchResult) =>
      r.media_type === "movie" ? r.release_date : r.first_air_date;

    function normalizeLoose(s: string) {
      const n = normalizeTitle(s);
      // treat leading "the" as optional (e.g., "Godfather" ~= "The Godfather")
      return n.startsWith("the") ? n.slice(3) : n;
    }

    const inputTitle = mafiaMovieTitle.trim();
    const inputNorm = normalizeTitle(inputTitle);
    const inputLoose = normalizeLoose(inputTitle);

    const ranked = results
      .map((r) => {
        const title = getTitle(r) ?? "";
        const titleLower = title.toLowerCase();

        const titleNorm = normalizeTitle(title);
        const titleLoose = normalizeLoose(title);

        const exact = titleNorm === inputNorm;
        const exactLoose = titleLoose === inputLoose;

        const contains = titleLower.includes(inputTitle.toLowerCase());

        // Light nostalgia, but don't reward ancient years over popularity.
        const releaseDate = getReleaseDate(r);
        const year = releaseDate ? Number(releaseDate.slice(0, 4)) : 9999;

        // Soft preference for ~1970–2005 "mafia era" (doesn't hard-ban others)
        const eraBonus =
          year >= 1970 && year <= 2005 ? 250 : 0;

        // Small penalty for *very* old titles unless they are massively voted
        const ancientPenalty =
          year < 1955 ? -800 : 0;

        // If the user typed a year (e.g. "Scarface 1983"), respect it
        const inputHasYear = /\b(19|20)\d{2}\b/.test(inputTitle);
        const yearMatchBonus =
          inputHasYear && inputTitle.includes(String(year)) ? 2500 : 0;

        const overview = (r.overview ?? "").toLowerCase();
        const mafiaHit =
          overview.includes("mafia") ||
          overview.includes("mob") ||
          overview.includes("gangster") ||
          overview.includes("organized crime");

        // Popularity + votes: strong "this is the famous one" signal.
        const pop = typeof r.popularity === "number" ? r.popularity : 0;
        const votes = typeof r.vote_count === "number" ? r.vote_count : 0;

        // 🔒 Require minimum credibility for "classic" picks
        const MIN_CLASSIC_VOTES = 500;
        const credible = votes >= MIN_CLASSIC_VOTES;

        // Log votes so huge titles win without the score exploding.
        const voteScore = Math.log10(votes + 1) * 250; // ~0..1000-ish
        const popScore = pop * 8;


        const score =
          (exact ? 8000 : 0) +
          (exactLoose ? 6000 : 0) +
          (contains ? 400 : 0) +
          (mafiaHit ? 700 : 0) +
          popScore +
          voteScore +
          eraBonus +
          ancientPenalty +
          yearMatchBonus +
          (credible ? 0 : -10_000);

        return { ...r, _score: score };
      })
      .sort((a, b) => (b as any)._score - (a as any)._score);

    const best = ranked[0];

    if (!best?.id) {
      clearTimeout(timeoutId);
      return NextResponse.json({ error: `No movie or TV show found for "${mafiaMovieTitle}"` }, { status: 404 });
    }

    const mediaId = String(best.id);
    const mediaType = best.media_type;
    const resolvedTitle = getTitle(best) ?? "";
    const releaseDate = getReleaseDate(best) ?? "";

    // Cache only for non-force calls (Generate). Regenerate uses force:true so it always changes.
    // Bump cache version so old behavior won't hit (v11 for fixed style).
    const cacheKey = `v11|${mediaId}|${mediaType}|${toppingPhrase}`;
    if (!force) {
      const cached = cacheGet(cacheKey);
      if (cached) {
        clearTimeout(timeoutId);
        return NextResponse.json({ ...cached, cached: true });
      }
    }

    // TMDB credits (cast + crew) - different endpoints for movies vs TV shows
    const creditsPath = mediaType === "movie"
      ? `movie/${mediaId}/credits`
      : `tv/${mediaId}/aggregate_credits`;
    const credits = await tmdbFetch(creditsPath, { language: "en-US" }, abortController.signal);
    const cast: TMDBCreditsCast[] = Array.isArray(credits?.cast) ? credits.cast : [];
    const crew: TMDBCreditsCrew[] = Array.isArray(credits?.crew) ? credits.crew : [];

    // Extract directors from crew
    const directors = crew.filter((c) => c.job === "Director");

    const topCast = cast
      .slice()
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .slice(0, 24)
      .map((c) => {
        // ✅ preserve TMDB capitalization in the phrases we store
        const actorFirstPhrase = normalizeNamePreserveCase(detectFirstNamePhrase(c.name));
        const actorLastPhrase = normalizeNamePreserveCase(detectLastNamePhrase(c.name));

        // For TV shows, character is in roles[0].character; for movies, it's c.character
        const character = c.character || c.roles?.[0]?.character || "";

        const characterFirstPhrase = character
          ? normalizeNamePreserveCase(detectFirstNamePhrase(character))
          : "";
        const characterLastPhrase = character
          ? normalizeNamePreserveCase(detectLastNamePhrase(character))
          : "";

        return {
          actorFirstPhrase,
          actorLastPhrase,
          characterFirstPhrase,
          characterLastPhrase,
          castOrder: c.order ?? 999,
        };
      });

    // Add directors to the cast list (with high priority - order 0)
    // For directors, preserve middle names as part of last name (e.g., "Ford Coppola" not just "Coppola")
    const directorEntries = directors.map((d) => {
      const parts = splitWords(d.name);
      const directorFirstPhrase = parts.length > 0 ? normalizeNamePreserveCase(parts[0]) : "";
      // Everything after first name becomes the "last name phrase" (e.g., "Ford Coppola")
      const directorLastPhrase = parts.length > 1
        ? normalizeNamePreserveCase(parts.slice(1).join(" "))
        : "";

      return {
        actorFirstPhrase: directorFirstPhrase,
        actorLastPhrase: directorLastPhrase,
        characterFirstPhrase: "", // Directors don't have character names
        characterLastPhrase: "",
        castOrder: 0, // Give directors highest priority
      };
    });

    // Combine directors + cast (directors first for priority)
    const allCast = [...directorEntries, ...topCast];

    const { rerank } = buildFilterAndReranker(toppingPhrase, allCast, style);

    // ✅ In-flight dedupe key collapses repeated clicks while the first is running.
    // Include exclude list (normalized) so "Regenerate (no repeats)" stays correct.
    const excludeKey = Array.from(excludeSet).sort().join("|");
    const inflightKey = `${cacheKey}|${force ? "force" : "gen"}|ex=${excludeKey}`;

    if (inflight.has(inflightKey)) {
      const payload = await inflight.get(inflightKey)!;
      return NextResponse.json({ ...payload, deduped: true });
    }

    // Streamlined prompt for faster generation
    const system = `Generate mafia-style pizza nicknames. Output JSON only.

Rules:
- Each name = exactly 2 parts: TOPPING + NAME_PHRASE
- Valid: "<TOPPING> <LASTNAME>" or "<FIRSTNAME> <TOPPING>"
- Use cast/director names from the provided list
- Preserve capitalization (e.g. "De Niro", "LaBeouf")
- NO excluded names

Return: {"suggestions":["name1","name2","name3"],"candidatePool":["...50 items..."]}`;

    // ✅ Only ONE OpenAI call per request (prevents single-click consuming multiple RPM).
    const job = (async () => {
      // Best-effort local throttle so we fail fast with a friendly Retry-After.
      checkLocalRpmOrThrow();

      // Compact prompt for speed
      const promptObj = {
        topping: toppingPhrase,
        movie: resolvedTitle,
        directors: directorEntries.slice(0, 3).map(d => ({ first: d.actorFirstPhrase, last: d.actorLastPhrase })),
        cast: topCast.slice(0, 12).map(c => ({
          actor: { first: c.actorFirstPhrase, last: c.actorLastPhrase },
          char: { first: c.characterFirstPhrase, last: c.characterLastPhrase },
        })),
        exclude: Array.from(excludeSet).slice(0, 50),
      };

      const resp = await callOpenAIWithBackoff(() =>
        openai.responses.create({
          model: "gpt-4o-mini",
          input: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(promptObj) },
          ],
          text: { format: { type: "json_object" } },
          max_output_tokens: 800, // Reduced for speed
        })
      );

      let parsed: any;
      try {
        parsed = JSON.parse(resp.output_text);
      } catch {
        throw new Error("Model returned invalid JSON.");
      }

      const rawPool: string[] = Array.isArray(parsed?.candidatePool) ? parsed.candidatePool : [];
      const rawSuggestions: string[] = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];

      const combined = [...rawSuggestions, ...rawPool].map(sanitizeNameKeepSpaces).filter(Boolean);

      const reranked = rerank(combined);

      // Remove excluded names (previous batches)
      const fresh = reranked.filter((n) => !excludeSet.has(n.trim().toLowerCase()));

      const finalSuggestions = fresh.slice(0, 3);
      const finalPool = fresh.slice(0, 50); // Reduced pool size for speed

      if (finalSuggestions.length < 3) {
        throw new Error(
          "Could not generate 3 new (non-repeating) names under the rules. Try a different topping/movie or loosen constraints."
        );
      }

      const payload = {
        cached: false,
        topping: toppingPhrase,
        mafiaMovieTitle,
        resolvedMovieTitle: resolvedTitle,
        tmdbMovieId: mediaId,
        releaseDate,
        mediaType,
        style,
        suggestions: finalSuggestions,
        candidatePool: finalPool,
      };

      if (!force) cacheSet(cacheKey, payload);

      return payload;
    })();

    inflight.set(inflightKey, job);

    try {
      const payload = await job;
      clearTimeout(timeoutId);

      return new NextResponse(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": force ? "no-store" : "s-maxage=86400, stale-while-revalidate=604800",
        },
      });
    } finally {
      inflight.delete(inflightKey);
    }
  } catch (err: any) {
    clearTimeout(timeoutId);

    // Handle timeout/abort errors
    if (err?.name === "AbortError" || err?.message?.includes("aborted")) {
      return NextResponse.json(
        { error: "Request timed out. Please try again." },
        { status: 504 }
      );
    }

    if (err?.status === 429 || isRateLimitError(err)) {
      const retryAfter = Number(err?.retryAfter ?? 20);
      return NextResponse.json(
        { error: `Rate limited by OpenAI. Please try again in ~${retryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    return NextResponse.json({ error: String(err?.message ?? "Unknown error") }, { status: 500 });
  }
}
