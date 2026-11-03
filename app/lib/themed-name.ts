// app/lib/themed-name.ts
//
// Optional "themed names only" rule for display (mafia) names, behind the
// setting names.requireThemed (off by default). A name passes when it:
//   - is unchanged from the member's current name (existing names are grandfathered),
//   - was offered by the name generator to this member (a signed, public claim), or
//   - contains a recognised topping or pizza word.

import { prisma } from "@/app/lib/db";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { PIZZA_TOPPINGS } from "@/app/lib/topping-images";

/** Extra pizza words that count besides the catalog toppings. */
const PIZZA_WORDS = [
  "pizza", "pie", "slice", "crust", "dough", "cheese", "sauce", "tomato", "pepperoni", "margherita",
  "marinara", "calzone", "stromboli", "focaccia", "napoli", "neapolitan", "sicilian", "oven", "pizzaiolo",
  "pizzeria", "mozz", "mozzarella", "basil", "oregano", "garlic", "pesto", "salami", "bacon", "ham",
  "mushroom", "olive", "anchovy", "sausage", "pineapple", "jalapeno", "capricciosa", "diavola", "bianca",
];

function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const THEME_TOKENS: Set<string> = new Set([
  ...PIZZA_WORDS,
  ...PIZZA_TOPPINGS.flatMap((t) => words(t).filter((w) => w.length >= 3)),
]);

/** Whether the name contains a recognised topping or pizza word (plurals match). */
export function isThemedName(name: string): boolean {
  return words(name).some((w) => THEME_TOKENS.has(w) || (w.endsWith("s") && THEME_TOKENS.has(w.slice(0, -1))));
}

export const NAME_NOT_THEMED_ERROR =
  "Pick a name from the generator, or include a pizza topping or pizza word in your name.";

/**
 * Whether `name` may be saved for this member. Always true while the setting is off.
 * `currentName` is what the member has today (so keeping it is always fine).
 */
export async function themedNameAllowed(opts: {
  name: string;
  discordId?: string;
  /** Looked up only when the rule is on and the name is not otherwise accepted. */
  currentName?: () => Promise<string | null | undefined>;
}): Promise<boolean> {
  if (!(await toggleEnabled("names.requireThemed"))) return true;
  const name = opts.name.trim();
  if (!name) return true; // emptiness is rejected elsewhere
  if (isThemedName(name)) return true;
  const current = opts.currentName ? await opts.currentName().catch(() => null) : null;
  if (current && current.trim().toLowerCase() === name.toLowerCase()) return true;
  if (opts.discordId) {
    const offered = await prisma.mafiaNameClaim.findFirst({
      where: { discordId: opts.discordId, public: true, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (offered) return true;
  }
  return false;
}
