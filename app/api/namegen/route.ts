// app/api/namegen/route.ts
import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type TMDBSearchResult = {
  id: number;
  title: string;
  release_date?: string;
  overview?: string;
  popularity?: number;
  vote_count?: number;
  vote_average?: number;
};

type TMDBCreditsCast = {
  name: string;
  character?: string;
  order?: number;
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

async function tmdbFetch(path: string, params: Record<string, string>) {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("Missing TMDB_API_KEY");

  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
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
  try {
    const body = await req.json();

    const toppingRaw = clampStr(body.topping, 80);
    const mafiaMovieTitle = clampStr(body.movieTitle, 120);
    const style: "balanced" | "serious" | "goofy" =
      body.style === "serious" || body.style === "goofy" ? body.style : "balanced";

    const force = body?.force === true;

    const exclude: string[] = Array.isArray(body?.exclude) ? body.exclude : [];
    const excludeSet = new Set(
      exclude.map((x) => String(x ?? "").trim().toLowerCase()).filter(Boolean)
    );

    if (!toppingRaw || !mafiaMovieTitle) {
      return NextResponse.json({ error: "Provide topping and movieTitle." }, { status: 400 });
    }

    const toppingPhrase = titleCase(toppingRaw);

    // TMDB search (English overview)
    const search = await tmdbFetch("search/movie", {
      query: mafiaMovieTitle,
      include_adult: "false",
      language: "en-US",
    });

    const results: TMDBSearchResult[] = Array.isArray(search?.results) ? search.results : [];

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
        const title = r.title ?? "";
        const titleLower = title.toLowerCase();

        const titleNorm = normalizeTitle(title);
        const titleLoose = normalizeLoose(title);

        const exact = titleNorm === inputNorm;
        const exactLoose = titleLoose === inputLoose;

        const contains = titleLower.includes(inputTitle.toLowerCase());

        const year = r.release_date ? Number(r.release_date.slice(0, 4)) : 9999;

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
          Math.max(0, 2600 - year) +
          (credible ? 0 : -10_000);

        return { ...r, _score: score };
      })
      .sort((a, b) => (b as any)._score - (a as any)._score);

    const best = ranked[0];

    if (!best?.id) {
      return NextResponse.json({ error: `No movie found for "${mafiaMovieTitle}"` }, { status: 404 });
    }

    const movieId = String(best.id);
    const releaseDate = best.release_date ?? "";

    // Cache only for non-force calls (Generate). Regenerate uses force:true so it always changes.
    // Bump cache version so old "Al Pacino" lastname-phrase cache won't hit.
    const cacheKey = `v7|${movieId}|${toppingPhrase}|${style}`;
    if (!force) {
      const cached = cacheGet(cacheKey);
      if (cached) return NextResponse.json({ ...cached, cached: true });
    }

    // TMDB credits
    const credits = await tmdbFetch(`movie/${movieId}/credits`, { language: "en-US" });
    const cast: TMDBCreditsCast[] = Array.isArray(credits?.cast) ? credits.cast : [];

    const topCast = cast
      .slice()
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .slice(0, 24)
      .map((c) => {
        // ✅ preserve TMDB capitalization in the phrases we store
        const actorFirstPhrase = normalizeNamePreserveCase(detectFirstNamePhrase(c.name));
        const actorLastPhrase = normalizeNamePreserveCase(detectLastNamePhrase(c.name));

        const characterFirstPhrase = c.character
          ? normalizeNamePreserveCase(detectFirstNamePhrase(c.character))
          : "";
        const characterLastPhrase = c.character
          ? normalizeNamePreserveCase(detectLastNamePhrase(c.character))
          : "";

        return {
          actorFirstPhrase,
          actorLastPhrase,
          characterFirstPhrase,
          characterLastPhrase,
          castOrder: c.order ?? 999,
        };
      });

    const { rerank } = buildFilterAndReranker(toppingPhrase, topCast, style);

    // We’ll retry a few times if the model outputs repeats or invalid combos.
    const maxAttempts = 3;

    const system = `
You are a comedy name-writer with excellent taste for mafia-movie nicknames.
Names should feel human-chosen, not random, and not like menu items.

Hard rules (MUST follow):
- Output ONLY valid JSON.
- Each name MUST be EXACTLY TWO PARTS (two chunks), not necessarily two single words.
- ONE PART MUST be the topping phrase EXACTLY (case-insensitive), e.g. "Green Pepper".
- The OTHER PART MUST be a cast-name phrase from the provided list.
- Valid forms ONLY:
  1) "<TOPPING_PHRASE> <LASTNAME_PHRASE>"
  2) "<FIRSTNAME_PHRASE> <TOPPING_PHRASE>"
- Do NOT output "<TOPPING_PHRASE> <FIRSTNAME_PHRASE>"
- Do NOT output "<LASTNAME_PHRASE> <TOPPING_PHRASE>"
- Lastname phrases may contain spaces (e.g. "De Niro", "Van Zandt")
- Preserve capitalization as provided in the cast phrases (e.g. "LaBeouf", not "Labeouf").
- IMPORTANT: For "Al Pacino", the lastname is "Pacino" (NOT "Al Pacino"). Same idea for other first+last pairs.

Return JSON:
{
  "candidatePool": ["..."],  // 50 items
  "suggestions": ["...", "...", "..."] // best 3 in order
}
`;

    let finalSuggestions: string[] = [];
    let finalPool: string[] = [];
    let lastRaw: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const promptObj = {
        toppingPhrase,
        movie: {
          inputTitle: mafiaMovieTitle,
          resolvedTitle: best.title,
          releaseDate,
          tmdbMovieId: movieId,
        },
        style,
        cast: topCast,
        excludeNames: Array.from(excludeSet).slice(0, 200),
        instruction:
          "Generate 50 candidates, then pick the best 3. Use EXACT forms only. Do NOT output anything in excludeNames (case-insensitive).",
        attempt,
      };

      const resp = await openai.responses.create({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(promptObj) },
        ],
        text: { format: { type: "json_object" } },
        max_output_tokens: 1000,
      });

      let parsed: any;
      try {
        parsed = JSON.parse(resp.output_text);
      } catch {
        lastRaw = resp.output_text;
        continue;
      }

      lastRaw = parsed;

      const rawPool: string[] = Array.isArray(parsed?.candidatePool) ? parsed.candidatePool : [];
      const rawSuggestions: string[] = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];

      const combined = [...rawSuggestions, ...rawPool].map(sanitizeNameKeepSpaces).filter(Boolean);

      const reranked = rerank(combined);

      // Remove excluded names (previous batches)
      const fresh = reranked.filter((n) => !excludeSet.has(n.trim().toLowerCase()));

      const suggestions = fresh.slice(0, 3);
      const pool = fresh.slice(0, 50);

      if (suggestions.length >= 3) {
        finalSuggestions = suggestions;
        finalPool = pool;
        break;
      }
    }

    if (finalSuggestions.length < 3) {
      return NextResponse.json(
        {
          error:
            "Could not generate 3 new (non-repeating) names under the rules. Try a different topping/movie or loosen constraints.",
          raw: lastRaw,
        },
        { status: 502 }
      );
    }

    const payload = {
      cached: false,
      topping: toppingPhrase,
      mafiaMovieTitle,
      resolvedMovieTitle: best.title,
      tmdbMovieId: movieId,
      releaseDate,
      style,
      suggestions: finalSuggestions,
      candidatePool: finalPool,
    };

    if (!force) cacheSet(cacheKey, payload);

    return new NextResponse(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        // Regenerate should always be fresh
        "Cache-Control": force ? "no-store" : "s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
