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

/** Pizza words that count on their own. Generic single words (pie, ham, oven, hot, red...) are left out on purpose. */
const PIZZA_WORDS = [
  "pizza", "pizzas", "slice", "crust", "dough", "cheese", "sauce", "pepperoni", "margherita",
  "marinara", "calzone", "stromboli", "focaccia", "neapolitan", "sicilian", "pizzaiolo",
  "pizzeria", "mozzarella", "mozz", "basil", "oregano", "garlic", "pesto", "salami", "bacon",
  "mushroom", "olive", "anchovy", "sausage", "pineapple", "jalapeno", "capricciosa", "diavola",
  // toppings and cheeses
  "steak", "paneer", "tandoori", "bufala", "buffalo", "spinach", "caprese", "cherry", "banana",
  "turkey", "salame", "quesos", "queso", "prosciutto", "pancetta", "chorizo", "ricotta", "burrata",
  "parmesan", "parmigiano", "gorgonzola", "provolone", "feta", "artichoke", "arugula", "rucola",
  "onion", "pepper", "chicken", "beef", "meatball", "egg", "corn", "tuna", "shrimp", "truffle",
  "eggplant", "zucchini", "hawaiian", "hawaiano", "bbq", "tomato",
  // Spanish / Portuguese / Italian and other toppings and pizza words
  "piña", "pina", "champiñon", "champinon", "cebolla", "pollo", "jamon", "albahaca", "palmito",
  "palmitos", "provoleta", "calabresa", "rucula", "funghi", "napolitana", "napoletana",
  "stracciatella", "guanciale", "serrano", "capsicum", "chili", "chilli", "suya", "sardine",
  "honey", "walnut", "aubergine", "sourdough", "hotdog", "fries", "supreme", "suprema",
  "quattro", "mexicana", "menta", "jengibre", "ginger", "capparis", "caper", "marinara",
  "vegetable", "veggie", "meat", "pepperone", "chilorio", "chikanda",
];

/** Common misspellings, matched exactly (no fuzzy matching). */
const ALIASES = [
  "jalepeno", "jalapeno", "jalepeño", "peperoni", "pepperonni", "mozarella", "mozzarela",
  "proscuitto", "prosciuto", "parmesean", "parmigiana", "chorrizo", "anchovie",
  "marguerita", "margarita", "pinnaple", "pinapple", "cheeze", "guancciale",
];

/** Multi-word catalog toppings only match as the whole phrase; single-word ones match as words. */
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const SINGLE_TOKENS: Set<string> = new Set([
  ...PIZZA_WORDS,
  ...ALIASES.filter((a) => words(a).length === 1).flatMap((a) => words(a)),
  ...PIZZA_TOPPINGS.filter((t) => words(t).length === 1).flatMap((t) => words(t)),
]);
const EXTRA_PHRASES = ["peri peri", "pili pili", "hot dog"];
const PHRASES: string[] = [...EXTRA_PHRASES, ...PIZZA_TOPPINGS].filter((t) => words(t).length > 1).map((t) => words(t).join(" "));

const singular = (w: string) => (w.endsWith("s") ? w.slice(0, -1) : w);
/** Plural forms: "-s" and "-es" (tomatoes). */
const stems = (w: string) => [w, singular(w), ...(w.endsWith("es") ? [w.slice(0, -2)] : [])];

/** Whether the name contains a recognised topping or pizza word (plurals match). */
export function isThemedName(name: string): boolean {
  const ws = words(name);
  if (ws[0] === "don" && ws.length > 1) return true; // "Don Malbec": mafia-themed
  if (ws.some((w) => stems(w).some((x) => SINGLE_TOKENS.has(x)))) return true;
  const joined = " " + ws.map(singular).join(" ") + " ";
  return PHRASES.some((p) => joined.includes(" " + p.split(" ").map(singular).join(" ") + " "));
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
