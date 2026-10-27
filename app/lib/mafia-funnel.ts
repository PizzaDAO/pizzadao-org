// app/lib/mafia-funnel.ts
//
// Funnel events for the mafia-name flow (plans/mafia-name-port.md, Phase 2),
// recorded through the existing ActivationEvent mechanism. ActivationEvent
// dedupes on actor + event + code, so each code below is a *distinct thing
// that happened* (a topping, a film, the Nth reroll), not a counter. Codes are
// closed vocabularies so the public /api/activation endpoint cannot be used to
// mint arbitrary rows. Pure and client-safe.
import { MAFIA_FILMS } from "@/app/lib/mafia-films";
import { PIZZA_TOPPINGS } from "@/app/lib/topping-images";

/** Events the browser may report (name_claimed is written server-side). */
export const FUNNEL_CLIENT_EVENTS = ["topping_picked", "film_picked", "names_generated", "name_rerolled"] as const;
export type FunnelClientEvent = (typeof FUNNEL_CLIENT_EVENTS)[number];

export const MAX_REROLL_CODE = 10;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const TOPPING_CODES = new Set(PIZZA_TOPPINGS.map(slug));
const FILM_CODES = new Set(MAFIA_FILMS.map((f) => slug(f.id)));

/** Catalog topping -> its slug, anything typed by hand -> "custom". */
export function toppingCode(topping: string): string {
  const s = slug(topping);
  return TOPPING_CODES.has(s) ? s : "custom";
}

/** Catalog film (matched by title or id) -> its id slug, anything else -> "custom". */
export function filmCode(title: string): string {
  const t = title.trim().toLowerCase();
  const film = MAFIA_FILMS.find((f) => f.title.toLowerCase() === t || f.id === t);
  return film ? slug(film.id) : "custom";
}

/** 1-based reroll count, capped so the vocabulary stays closed. */
export function rerollCode(n: number): string {
  return `r${Math.min(Math.max(1, Math.floor(n) || 1), MAX_REROLL_CODE)}`;
}

export function isFunnelClientEvent(event: unknown): event is FunnelClientEvent {
  return (FUNNEL_CLIENT_EVENTS as readonly unknown[]).includes(event);
}

export function isValidFunnelCode(event: FunnelClientEvent, code: unknown): boolean {
  if (typeof code !== "string") return false;
  switch (event) {
    case "topping_picked":
      return code === "custom" || TOPPING_CODES.has(code);
    case "film_picked":
      return code === "custom" || FILM_CODES.has(code);
    case "names_generated":
      return code === "ok";
    case "name_rerolled":
      return /^r([1-9]|10)$/.test(code);
  }
}
