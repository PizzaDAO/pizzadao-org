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

/**
 * Find the best matching city chapter for a given user city string.
 * Uses case-insensitive matching with partial match support.
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
    return n.length >= 3 && query.includes(n);
  });
  if (cityInQuery) return cityInQuery;

  // 3. User input contained in city name
  const queryInCity = chapters.find((c) => {
    const n = normalize(c.city);
    return query.length >= 3 && n.includes(query);
  });
  if (queryInCity) return queryInCity;

  // 4. Word-level matching: check if the primary city word appears
  const queryWords = query.split(/[\s,]+/).filter((w) => w.length >= 3);
  for (const chapter of chapters) {
    const chapterWords = normalize(chapter.city)
      .split(/[\s,]+/)
      .filter((w) => w.length >= 3);
    const hasMatch = queryWords.some((qw) =>
      chapterWords.some((cw) => cw === qw)
    );
    if (hasMatch) return chapter;
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
