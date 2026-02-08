import { NextRequest, NextResponse } from "next/server";
import { parseGvizJson, getCellValue, normalizeString } from "@/app/lib/gviz-parser";
import { cacheGetOrSet } from "@/app/api/lib/cache";

const CITY_CHAPTERS_SHEET_ID = "16T3_iXywToXQqxTyDIniWIA4SUI8Wj0a5LKHSAJL_9Q";
const CITY_CHAPTERS_GID = "811297100";
const CACHE_KEY = "city-chapters:v1";
const CACHE_TTL = 60 * 10; // 10 minutes

// Expected header column names for dynamic header detection
const EXPECTED_HEADERS = ["city", "chat", "country", "region", "host", "status"];

type CityChapter = {
  city: string;
  country: string;
  region: string;
  chatUrl: string;
  host: string;
};

/**
 * Fetch and parse city chapters from Google Sheets.
 * Uses dynamic header detection since the header row may not be at row 0.
 */
async function fetchCityChapters(): Promise<CityChapter[]> {
  const url = `https://docs.google.com/spreadsheets/d/${CITY_CHAPTERS_SHEET_ID}/gviz/tq?tqx=out:json&gid=${CITY_CHAPTERS_GID}&headers=0`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch city chapters sheet: ${res.status}`);
  }

  const text = await res.text();
  const gviz = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  // Dynamic header detection: scan the first 15 rows for one that looks like a header
  let headerRowIdx = -1;
  let cityIdx = -1;
  let chatIdx = -1;
  let countryIdx = -1;
  let regionIdx = -1;
  let hostIdx = -1;

  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cells = rows[i]?.c || [];
    const values = cells.map((c) => normalizeString(getCellValue(c)));

    // Count how many expected headers appear in this row
    const matchCount = EXPECTED_HEADERS.filter((h) =>
      values.some((v) => v === h || v.includes(h))
    ).length;

    // Need at least 3 matches to consider it a header row
    if (matchCount >= 3) {
      headerRowIdx = i;

      // Map column indices
      for (let j = 0; j < values.length; j++) {
        const v = values[j];
        if (v === "city" || v.includes("city")) cityIdx = j;
        else if (v === "chat" || v.includes("chat")) chatIdx = j;
        else if (v === "country" || v.includes("country")) countryIdx = j;
        else if (v === "region" || v.includes("region")) regionIdx = j;
        else if (v === "host" || v.includes("host")) hostIdx = j;
      }
      break;
    }
  }

  if (headerRowIdx === -1 || cityIdx === -1) {
    console.warn("[city-telegram] Could not detect header row in city chapters sheet");
    return [];
  }

  // Parse data rows below the header
  const chapters: CityChapter[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const cells = rows[i]?.c || [];
    const city = getCellValue(cells[cityIdx]).trim();
    if (!city) continue;

    // Extract chat URL - check for hyperlink first, then raw value
    let chatUrl = "";
    if (chatIdx !== -1) {
      const chatCell = cells[chatIdx];
      if (chatCell) {
        // Check hyperlink property
        if (chatCell.l) {
          chatUrl = chatCell.l;
        } else {
          const raw = getCellValue(chatCell).trim();
          if (raw.startsWith("http")) {
            chatUrl = raw;
          }
        }
      }
    }

    const country = countryIdx !== -1 ? getCellValue(cells[countryIdx]).trim() : "";
    const region = regionIdx !== -1 ? getCellValue(cells[regionIdx]).trim() : "";
    const host = hostIdx !== -1 ? getCellValue(cells[hostIdx]).trim() : "";

    chapters.push({ city, country, region, chatUrl, host });
  }

  return chapters;
}

/**
 * Find the best matching city chapter for a given user city string.
 * Uses case-insensitive matching with partial match support.
 */
function findBestMatch(
  userCity: string,
  chapters: CityChapter[]
): CityChapter | null {
  const query = normalizeString(userCity);
  if (!query) return null;

  // Only match chapters that have a chat URL
  const withChat = chapters.filter((c) => c.chatUrl);
  if (withChat.length === 0) return null;

  // 1. Exact city match (case-insensitive)
  const exact = withChat.find((c) => normalizeString(c.city) === query);
  if (exact) return exact;

  // 2. City name contained in user input (e.g. "New York, NY" matches "New York")
  const cityInQuery = withChat.find((c) => {
    const normalizedCity = normalizeString(c.city);
    return normalizedCity.length >= 3 && query.includes(normalizedCity);
  });
  if (cityInQuery) return cityInQuery;

  // 3. User input contained in city name
  const queryInCity = withChat.find((c) => {
    const normalizedCity = normalizeString(c.city);
    return query.length >= 3 && normalizedCity.includes(query);
  });
  if (queryInCity) return queryInCity;

  // 4. Word-level matching: check if the primary city word appears
  const queryWords = query.split(/[\s,]+/).filter((w) => w.length >= 3);
  for (const chapter of withChat) {
    const chapterWords = normalizeString(chapter.city)
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

    // Fetch city chapters with caching
    const chapters = await cacheGetOrSet<CityChapter[]>(
      CACHE_KEY,
      fetchCityChapters,
      CACHE_TTL
    );

    const match = findBestMatch(userCity, chapters);

    if (!match) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({
      found: true,
      city: match.city,
      country: match.country,
      region: match.region,
      chatUrl: match.chatUrl,
      host: match.host,
    });
  } catch (error) {
    console.error("[city-telegram] Error:", error);
    return NextResponse.json(
      { error: "Failed to look up city chapter" },
      { status: 500 }
    );
  }
}
