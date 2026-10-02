/**
 * City → timezone resolution (pizzaiolo-13628).
 *
 * Onboarding's CityStep already gets a Google Places `place_id` from
 * /api/city-autocomplete. This module geocodes that place and asks the
 * Google Time Zone API for its IANA zone, using the same GOOGLE_MAPS_API_KEY.
 *
 * Storage: the members "Crew" sheet has no Timezone column (and
 * backend_script.gs only writes known columns), so the resolved zone is
 * persisted to MemberProfileExtras.timezone in Postgres.
 */

import { prisma } from "./db";

export type CityTimezone = {
  /** IANA ID, e.g. "America/New_York". */
  timezoneId: string;
  /** Google's long name, e.g. "Eastern Daylight Time". */
  timezoneName: string;
  /** Current UTC offset, e.g. "-4", "+5:30", "+0". */
  utcOffset: string;
  /** Short label for display, e.g. "EDT (UTC-4)". */
  label: string;
};

export class CityTimezoneError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: string | null = null,
  ) {
    super(message);
    this.name = "CityTimezoneError";
  }
}

type FetchLike = (url: string) => Promise<{ json: () => Promise<unknown> }>;

export type ResolveCityTimezoneOptions = {
  apiKey?: string;
  fetchImpl?: FetchLike;
  /** Defaults to now; the Time Zone API needs it to apply DST. */
  now?: Date;
};

/** Format an offset in seconds as "+5:30", "-5" or "+0". */
export function formatUtcOffset(totalSeconds: number): string {
  const sign = totalSeconds >= 0 ? "+" : "-";
  const abs = Math.abs(totalSeconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  if (minutes === 0) return `${sign}${hours}`;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Initials of a multi-word zone name: "Eastern Standard Time" → "EST".
 * Single-word names return "" (no meaningful abbreviation).
 */
export function abbreviateTimezoneName(name: string): string {
  const words = (name || "").split(/\s+/).filter(Boolean);
  if (words.length < 2) return "";
  return words.map((w) => w[0].toUpperCase()).join("");
}

/** True when `tz` is a timezone the runtime's Intl database recognizes. */
export function isValidTimezoneId(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type GeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
};

type TimezoneResponse = {
  status?: string;
  errorMessage?: string;
  timeZoneId?: string;
  timeZoneName?: string;
  rawOffset?: number;
  dstOffset?: number;
};

/** Resolve a Google Places `place_id` to its timezone. */
export async function resolveCityTimezone(
  placeId: string,
  opts: ResolveCityTimezoneOptions = {},
): Promise<CityTimezone> {
  const id = String(placeId ?? "").trim();
  if (!id) throw new CityTimezoneError("place_id is required", 400);

  const key = opts.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new CityTimezoneError("Missing GOOGLE_MAPS_API_KEY", 500);

  const doFetch: FetchLike = opts.fetchImpl ?? ((url) => fetch(url));

  // 1. place_id → lat/lng
  const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  geocodeUrl.searchParams.set("place_id", id);
  geocodeUrl.searchParams.set("key", key);
  const geo = (await (await doFetch(geocodeUrl.toString())).json()) as GeocodeResponse;

  if (geo.status !== "OK" || !geo.results?.length) {
    throw new CityTimezoneError(`Geocoding failed: ${geo.status}`, 502, geo.error_message ?? null);
  }
  const loc = geo.results[0].geometry?.location;
  if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") {
    throw new CityTimezoneError("Could not determine coordinates from place_id", 422);
  }

  // 2. lat/lng → timezone
  const timestamp = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const tzUrl = new URL("https://maps.googleapis.com/maps/api/timezone/json");
  tzUrl.searchParams.set("location", `${loc.lat},${loc.lng}`);
  tzUrl.searchParams.set("timestamp", String(timestamp));
  tzUrl.searchParams.set("key", key);
  const tz = (await (await doFetch(tzUrl.toString())).json()) as TimezoneResponse;

  if (tz.status !== "OK" || !tz.timeZoneId) {
    throw new CityTimezoneError(`Timezone API failed: ${tz.status}`, 502, tz.errorMessage ?? null);
  }

  const utcOffset = formatUtcOffset((tz.rawOffset ?? 0) + (tz.dstOffset ?? 0));
  const timezoneName = tz.timeZoneName ?? "";
  const abbrev = abbreviateTimezoneName(timezoneName);

  return {
    timezoneId: tz.timeZoneId,
    timezoneName,
    utcOffset,
    label: abbrev ? `${abbrev} (UTC${utcOffset})` : `UTC${utcOffset}`,
  };
}

/**
 * Persist a member's timezone. Ignores invalid IDs and never throws, so a
 * missing migration or DB hiccup can't break the onboarding submit.
 * Returns true when a row was written.
 */
export async function saveMemberTimezone(memberId: string, timezone: unknown): Promise<boolean> {
  if (!memberId || !isValidTimezoneId(timezone)) return false;
  try {
    await prisma.memberProfileExtras.upsert({
      where: { memberId },
      create: { memberId, timezone },
      update: { timezone },
    });
    return true;
  } catch {
    return false;
  }
}
