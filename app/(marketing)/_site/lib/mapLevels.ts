// Levels for the reach map, served by the PizzaDAO app (GET /api/public/map-levels).
// Every failure (network error, 404 while the switch is off, bad shape, timeout) gives null and the
// map renders exactly as it did before levels existed.

export type MapTier = { level: number; name: string };
export type MapCityLevel = { key: string; name: string; country: string; level: number; members?: string };
export type MapCountryLevel = { iso2: string; isoNumeric: string; name: string; level: number; members?: string };
export type MapLevels = {
  tiers: MapTier[];
  cities: MapCityLevel[];
  countries: MapCountryLevel[];
};

// Same origin: the app serves the marketing pages and this endpoint.
export const MAP_LEVELS_URL = "/api/public/map-levels";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isLevel = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1;
const optStr = (v: unknown) => v === undefined || typeof v === "string";

/** Validates the response by hand; anything unexpected is null. */
export function parseMapLevels(body: unknown): MapLevels | null {
  if (!isObj(body) || body.version !== 1) return null;
  const { tiers, cities, countries } = body;
  if (!Array.isArray(tiers) || !Array.isArray(cities) || !Array.isArray(countries)) return null;
  if (tiers.length === 0) return null;
  const tiersOk = tiers.every((t) => isObj(t) && isLevel(t.level) && typeof t.name === "string");
  const citiesOk = cities.every(
    (c) => isObj(c) && typeof c.key === "string" && typeof c.name === "string" && isLevel(c.level) && optStr(c.members),
  );
  const countriesOk = countries.every(
    (c) => isObj(c) && typeof c.isoNumeric === "string" && typeof c.name === "string" && isLevel(c.level) && optStr(c.members),
  );
  if (!tiersOk || !citiesOk || !countriesOk) return null;
  return { tiers, cities, countries } as MapLevels;
}

export async function fetchMapLevels(url: string = MAP_LEVELS_URL, timeoutMs = 5000): Promise<MapLevels | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return parseMapLevels(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- styling -------------------------------------------------------------------------------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 for the lowest tier, 1 for the highest (0 when there is only one tier). */
const frac = (level: number, tierCount: number) => (tierCount <= 1 ? 0 : (Math.min(Math.max(level, 1), tierCount) - 1) / (tierCount - 1));

/** Country fill: butter up to tomato, replacing the plain cream fill. */
export function countryFill(level: number, tierCount: number): string {
  const t = frac(level, tierCount);
  return `hsl(${Math.round(lerp(46, 8, t))} ${Math.round(lerp(70, 80, t))}% ${Math.round(lerp(86, 66, t))}%)`;
}

/** Marker size grows with the tier. */
export function markerRadius(level: number, tierCount: number): number {
  return Math.round(lerp(2.6, 5, frac(level, tierCount)) * 10) / 10;
}

/** Marker colour deepens with the tier (the site's tomato, darker). */
export function markerFill(level: number, tierCount: number): string {
  return `hsl(0 93% ${Math.round(lerp(64, 46, frac(level, tierCount)))}%)`;
}

export const BASE_COUNTRY_FILL = "hsl(44 30% 92%)";
