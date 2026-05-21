import { NextRequest, NextResponse } from "next/server";
import cityChapters from "@/data/city-chapters.json";

type CityChapter = {
  city: string;
  country: string;
  region: string;
  chatUrl: string;
};

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

// Generic suffixes that shouldn't be required to match. e.g. our "New York City"
// chapter shouldn't fail to match a user typing "New York, NY, USA" just because
// they didn't include the word "City".
const GENERIC_CHAPTER_SUFFIXES = new Set(["city"]);

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[\s,]+/)
    .filter((w) => w.length >= 3);
}

function chapterCoreTokens(city: string): string[] {
  return tokenize(city).filter((w) => !GENERIC_CHAPTER_SUFFIXES.has(w));
}

/**
 * Find the best matching city chapter for a given user city string.
 *
 * Match tiers (most specific first):
 *   1. Exact normalized equality with chapter city.
 *   2. Chapter city appears as a substring of the user query
 *      (handles "New York, NY" matching the "New York" chapter).
 *   3. All non-generic chapter tokens appear as tokens in the user query
 *      (handles "New York, NY, USA" matching "New York City" by stripping
 *      the generic "city" suffix; rejects "New Haven" for "New York, NY"
 *      because "haven" isn't a token in the query).
 *
 * NOTE: a previous tier matched on ANY shared token ≥3 chars. That caused
 * "New York, NY, USA" to match "New Haven" via the shared word "new".
 * The strict all-tokens-present rule replaces it.
 */
function findBestMatch(userCity: string): CityChapter | null {
  const query = normalize(userCity);
  if (!query) return null;

  const chapters = cityChapters as CityChapter[];

  // 1. Exact city match (case-insensitive)
  const exact = chapters.find((c) => normalize(c.city) === query);
  if (exact) return exact;

  // 2. City name contained in user input (e.g. "New York, NY" matches "New York")
  const cityInQuery = chapters.find((c) => {
    const n = normalize(c.city);
    return n.length >= 4 && query.includes(n);
  });
  if (cityInQuery) return cityInQuery;

  // 3. Strict token-level matching: ALL non-generic chapter tokens must
  //    appear as tokens in the user query.
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size > 0) {
    for (const chapter of chapters) {
      const chapterTokens = chapterCoreTokens(chapter.city);
      if (chapterTokens.length === 0) continue;
      const allPresent = chapterTokens.every((ct) => queryTokens.has(ct));
      if (allPresent) return chapter;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userCity = String(body?.city || "").trim();

    if (!userCity) {
      return NextResponse.json(
        { error: "City is required" },
        { status: 400 }
      );
    }

    const match = findBestMatch(userCity);

    if (!match) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({
      found: true,
      city: match.city,
      country: match.country,
      region: match.region,
      chatUrl: match.chatUrl,
    });
  } catch (error) {
    console.error("[city-telegram] Error:", error);
    return NextResponse.json(
      { error: "Failed to look up city chapter" },
      { status: 500 }
    );
  }
}
