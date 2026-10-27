// app/lib/mafia-join-params.ts
//
// The hand-off from the public /get-your-mafia-name page to /join
// (plans/mafia-name-port.md, Phase 3): `/join?from=mafia-name&name=&topping=&film=&o=`.
// Query strings are attacker-controlled, so everything is re-validated here and
// the wizard only ever sees the sanitized result. An invalid or absent hand-off
// yields null, and /join then behaves exactly as before. Pure and client-safe.
//
//   name     sanitizeDisplayName(); required (no name, no hand-off)
//   topping  a known topping (matched case-insensitively), else free text, 50 chars max
//   film     a MAFIA_FILMS id, else a free-text title, 120 chars max
//   o        optional JSON { kind, person, film, sig }: the origin line and the
//            namegen signature. Not trusted: the claim route verifies the HMAC
//            before it publishes anything, so a forged `o` just stays private.
import { sanitizeDisplayName } from "@/app/lib/display-name";
import { MAFIA_FILMS } from "@/app/lib/mafia-films";
import { NAME_ORIGIN_KINDS, type NameOriginWithFilm } from "@/app/lib/name-origin";
import { PIZZA_TOPPINGS } from "@/app/lib/topping-images";

export const JOIN_FROM = "mafia-name";
export const MAX_TOPPING = 50;
export const MAX_FILM_TITLE = 120;
const MAX_PERSON = 80;
const MAX_SIG = 100;
const MAX_ORIGIN_PARAM = 600;

/** Control/format characters out, whitespace collapsed, capped by code points. */
export function cleanFreeText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return Array.from(
    value
      .replace(/[\p{Cc}\p{Cf}<>]/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, max)
    .join("")
    .trim();
}

export type MafiaJoinPrefill = {
  name: string;
  topping: string;
  /** The film title the wizard shows (catalog title or the cleaned free text). */
  filmTitle: string;
  filmId?: string;
  origin?: NameOriginWithFilm;
  sig?: string;
};

export function canonicalTopping(value: unknown): string {
  const text = cleanFreeText(value, MAX_TOPPING);
  const known = PIZZA_TOPPINGS.find((t) => t.toLowerCase() === text.toLowerCase());
  return known ?? text;
}

function readOrigin(raw: string | null): { origin: NameOriginWithFilm; sig: string } | null {
  if (!raw || raw.length > MAX_ORIGIN_PARAM) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const person = cleanFreeText(o.person, MAX_PERSON);
    const film = cleanFreeText(o.film, MAX_FILM_TITLE);
    const sig = typeof o.sig === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(o.sig) ? o.sig.slice(0, MAX_SIG) : "";
    if (!person || !film || !sig) return null;
    if (!(NAME_ORIGIN_KINDS as readonly unknown[]).includes(o.kind)) return null;
    return { origin: { kind: o.kind as NameOriginWithFilm["kind"], person, film }, sig };
  } catch {
    return null;
  }
}

export function parseMafiaJoinParams(params: URLSearchParams): MafiaJoinPrefill | null {
  if (params.get("from") !== JOIN_FROM) return null;
  const name = sanitizeDisplayName(params.get("name") ?? "");
  if (!name) return null;

  const topping = canonicalTopping(params.get("topping"));

  const filmParam = params.get("film") ?? "";
  const catalog = MAFIA_FILMS.find((f) => f.id === filmParam.trim());
  const filmTitle = catalog?.title ?? cleanFreeText(filmParam, MAX_FILM_TITLE);

  const signed = readOrigin(params.get("o"));
  return {
    name,
    topping,
    filmTitle,
    ...(catalog ? { filmId: catalog.id } : {}),
    ...(signed ? { origin: signed.origin, sig: signed.sig } : {}),
  };
}

/** The /join link for a name picked on the public page. */
export function buildJoinHref(input: {
  name: string;
  topping?: string;
  filmTitle?: string;
  filmId?: string;
  origin?: NameOriginWithFilm;
  sig?: string;
}): string {
  const q = new URLSearchParams({ from: JOIN_FROM, name: input.name });
  if (input.topping) q.set("topping", cleanFreeText(input.topping, MAX_TOPPING));
  const film = input.filmId ?? cleanFreeText(input.filmTitle, MAX_FILM_TITLE);
  if (film) q.set("film", film);
  if (input.origin && input.sig) {
    q.set("o", JSON.stringify({ ...input.origin, sig: input.sig }));
  }
  return `/join?${q.toString()}`;
}
