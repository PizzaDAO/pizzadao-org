// app/lib/chats.ts
// Reads the Global Pizza Party Telegram chat directory from the rsvpizza
// Supabase project (cross-database). This data does NOT live in the onboarding
// app's Neon/Prisma DB — it is read over Supabase PostgREST with a plain fetch
// using the publishable (anon) key. rsv.pizza has since locked that table down, so when
// RSV_PIZZA_TELEGRAM_KEY is set the directory is read through the rsv.pizza send proxy instead
// (GET /city-groups, no chat ids); the anon read stays as the fallback.

export interface CityChat {
  slug: string;
  name: string;
  chatUrl: string;
  country: string | null;
  region: string | null;
  isSupergroup: boolean;
}

interface RawRow {
  city_key: string | null;
  chat_url: string | null;
  title: string | null;
  country: string | null;
  region: string | null;
  is_supergroup: boolean | null;
}

/**
 * Slugify a city_key for use in URLs.
 * - lowercase
 * - strip leading non-alphanumerics (handles dirty keys like "- nashville")
 * - replace any run of non-alphanumeric chars with a single hyphen
 * - trim leading/trailing hyphens
 * e.g. "- nashville" -> "nashville", "addis ababa" -> "addis-ababa"
 */
export function slugify(cityKey: string): string {
  return (cityKey || "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Human-readable display name for a city.
 * Prefers a non-empty `title`; otherwise Title-Cases the cleaned city_key.
 */
export function displayName(cityKey: string, title: string | null): string {
  const t = (title ?? "").trim();
  if (t) return t;

  const cleaned = (cityKey || "").replace(/^[^a-zA-Z0-9]+/, "").trim();
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

import { cityGroups, rsvTelegramConfigured } from "@/app/lib/telegram/rsv-client";

/** The directory from the rsv.pizza proxy, or null when it is not configured or unavailable. */
async function fetchViaProxy(): Promise<CityChat[] | null> {
  if (!rsvTelegramConfigured()) return null;
  const r = await cityGroups();
  if (!r.ok) {
    console.error(`[chats] rsv.pizza directory unavailable (${r.reason}), falling back`);
    return null;
  }
  const seen = new Set<string>();
  const cities: CityChat[] = [];
  for (const g of r.groups) {
    const chatUrl = (g.chatUrl ?? "").trim();
    if (!chatUrl) continue;
    const slug = slugify(g.cityKey);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    cities.push({
      slug,
      name: displayName(g.cityKey, g.title),
      chatUrl,
      country: g.country,
      region: g.region,
      // The proxy directory does not say; the badge is simply not shown.
      isSupergroup: false,
    });
  }
  return cities;
}

// ===== In-memory cache (~30 min TTL), mirrors app/lib/mission-cache.ts =====
let cityChatsCache: { data: CityChat[]; timestamp: number } | null = null;
const CITY_CHATS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch the full city chat directory from the rsvpizza Supabase project.
 * Result is cached in-memory for ~30 minutes.
 */
export async function getCityChats(): Promise<CityChat[]> {
  if (cityChatsCache && Date.now() - cityChatsCache.timestamp < CITY_CHATS_CACHE_TTL) {
    return cityChatsCache.data;
  }

  const viaProxy = await fetchViaProxy();
  if (viaProxy) {
    cityChatsCache = { data: viaProxy, timestamp: Date.now() };
    return viaProxy;
  }

  const baseUrl = (process.env.RSVPIZZA_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.RSVPIZZA_SUPABASE_ANON_KEY ?? "").trim();

  if (!baseUrl || !anonKey) {
    throw new Error(
      "RSVPIZZA_SUPABASE_URL and RSVPIZZA_SUPABASE_ANON_KEY must be set"
    );
  }

  const url =
    `${baseUrl}/rest/v1/city_telegram_groups` +
    `?select=city_key,chat_url,title,country,region,is_supergroup` +
    `&chat_url=not.is.null` +
    `&order=city_key.asc`;

  const res = await fetch(url, {
    // apikey alone works for both legacy JWT anon keys and new sb_publishable_
    // keys (new keys are not JWTs and must not be sent as a Bearer token).
    headers: {
      apikey: anonKey,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch city chats from Supabase (${res.status})`
    );
  }

  const rows: RawRow[] = await res.json();

  const seen = new Set<string>();
  const cities: CityChat[] = [];

  for (const row of rows) {
    const chatUrl = (row.chat_url ?? "").trim();
    if (!chatUrl) continue; // defensive: drop rows with no chat link

    const slug = slugify(row.city_key ?? "");
    if (!slug || seen.has(slug)) continue; // dedup by slug, keep first
    seen.add(slug);

    cities.push({
      slug,
      name: displayName(row.city_key ?? "", row.title),
      chatUrl,
      country: row.country,
      region: row.region,
      isSupergroup: !!row.is_supergroup,
    });
  }

  cityChatsCache = { data: cities, timestamp: Date.now() };
  return cities;
}

/**
 * Look up a single city chat by slug within the cached list.
 */
export async function getCityChatBySlug(slug: string): Promise<CityChat | null> {
  const cities = await getCityChats();
  return cities.find((c) => c.slug === slug) ?? null;
}
