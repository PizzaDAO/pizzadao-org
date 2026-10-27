// app/lib/mafia-portrait/prompt.ts
// Prompt builder for the finale portrait (plans/mafia-name-port.md, Phase 1).
//
// STYLE, TOPPING_MOTIF, FILM_MOOD and the animal list are ported from the
// Lovable site's generate-mafia-avatar function (reuse OK'd by Snax).
//
// Safety: the member's name and any free text (custom topping, custom film
// title) NEVER go into the prompt. The name only seeds the animal pick; the
// mood comes from the tone tags of a known film in MAFIA_FILMS.
import { createHash } from "crypto";
import { MAFIA_FILMS } from "@/app/lib/mafia-films";
import { PIZZA_TOPPINGS } from "@/app/lib/topping-images";

export const STYLE = `Vintage 1930s rubber-hose cartoon portrait of an ANTHROPOMORPHIC NEIGHBORHOOD ANIMAL — an initiate of the strange PizzaDAO underworld, a weird global pizza social club / lodge. Hand-drawn underground comic energy crossed with old union-hall poster art, inked risograph print work, and an old pizza shop mascot painted on a brick wall. Circular crop on warm cream background with a thick, slightly uneven dark navy border ring (imperfect, ink-bleed feel, like a hand-stamped membership badge).

THE TOPPING IS THE CHARACTER (most important):
- The pizza topping/ingredient IS the personality, the silhouette, the energy, the FACE of this portrait.
- The animal species is a vessel for the topping's vibe.
- The mafia/lodge styling is COSTUME — theater layered on top of an ingredient-first identity. It should never dominate.
- Goal: someone seeing this portrait reads the TOPPING first, the animal second, the mafia flavor third.

CHARACTER (vessel):
- anthropomorphic neighborhood animal — commit to the one species named below
- expressive, slightly cursed, charmingly suspicious — like a regular at a 3am pizza counter
- subtle social-club lodge energy (NOT criminal, NOT aggressive, NOT ethnic caricature)
- light wardrobe accent only (rumpled collar, lopsided cap, lapel pin, social-club sash) — kept minimal so the topping leads

LINE & TEXTURE:
- thick uneven black ink outlines with visible wobble, smudges, paper grain
- rubber-hose limb feeling even in a portrait crop
- flat shading with hatching/cross-hatching in shadows
- muted vintage palette: cream, mustard, oxblood, charcoal, faded teal, dusty brick — bent toward the topping's color signature
- tactile risograph misregistration, subtle off-print color halos
- avoid clean vector edges, avoid Pixar 3D polish, avoid furry-art rendering, avoid anime, avoid glossy lighting, avoid photoreal fur detail

TOPPING DOMINANCE (the entire portrait must read as the ingredient):
- the topping's color signature floods the palette and lighting
- the topping appears prominently (held, worn, growing out of the hat, dripping, smoked, pinned huge on the lapel, or fused into the character's features)
- the character's expression embodies the ingredient's personality — not generic mob swagger
- if forced to pick between "more mafia" and "more topping", always go MORE TOPPING

COMPOSITION: single anthropomorphic animal character, head-and-shoulders, centered, square 1:1, consistent framing across the whole portrait ecosystem.

NEGATIVE: no humans, no human faces, no real-world celebrities, no text, no letters, no logos, no watermarks, no clean vector, no symmetrical anime mascot, no chibi, no Pixar polish, no furry-art rendering, no aggressive crime imagery, no weapons, no ethnic stereotypes, no gendered human cues, no generic mobsters with a tiny pizza accessory — the topping must dominate.`;

// Ingredient-first personalities, keyed by the canonical names in PIZZA_TOPPINGS.
export const TOPPING_MOTIF: Record<string, string> = {
  Pepperoni: "saturated red-orange palette, loud and aggressive charisma, charred pepperoni-disc texture on the cheeks, spicy charismatic grin, oily shine, hot-headed neighborhood pride — pepperoni dominates the entire portrait",
  Mushroom: "earthy umber and damp moss palette, asymmetrical mushroom-cap silhouette on the head, weird soft-but-dangerous stillness, suspicious squint, gentle decay, fungal poetry — mushroom is the whole vibe",
  Basil: "fresh leafy greens drowning the palette, calm honest big-basil presence, basil leaves growing from the collar/hatband, sicilian grandmother warmth, herbal halo",
  Mozzarella: "soft cream and pale ivory palette, loyal soft-faced expression, melting mozzarella drip woven into the silhouette, gentle stretchy energy, everywhere-everyman vibe",
  Anchovy: "slicked oily palette, suspicious fishy gleam in the eye, anchovy silhouette pinned huge across the chest, sharp salty grin, old-school brine, smug and tiny and dangerous",
  Sausage: "heavy proud brown-red palette, sausage held like a cigar with thick curling smoke, brooklyn corner-shop weight, smoked-meat haze around the face",
  "Hot honey": "warm gold and chili-red palette, sticky honey dripping down the collar and chin, flashy chaotic smirk, gold-tooth glint, sweet-dangerous energy radiating off the portrait",
  Ricotta: "soft creamy off-white palette, gentle holy quiet, ricotta dollop motif, sicilian-grandmother stillness",
  Garlic: "bone-white and bruise-purple palette, sharp aggressive stare, garlic-bulb knuckles or garlic-cluster necklace, pungent intensity, dangerous focus",
  Onion: "watery determined eyes, papery onion-skin texture on the wardrobe, layered stubborn loyalty, faint tear",
  Olives: "muted olive-green and brine palette, bitter patient stare, olive pit centered between the eyes, sicilian endurance",
  Prosciutto: "elegant cured-pink palette, thin draped prosciutto slice across the shoulders like a sash, expensive lazy confidence",
  Pineapple: "sunny tropical yellow palette, controversial bright grin, pineapple crown sprouting from the head, brave chaotic warmth",
  "Jalapeño": "vivid jalapeño-green palette, quick unpredictable smirk, bead of sweat, fresh chili pinned to the lapel, hot-quick energy",
  "Banana peppers": "cheerful tangy yellow palette, sneaky-friendly grin, banana-pepper rings as collar accent",
  Soppressata: "spicy oxblood-red palette, weathered scowl, soppressata slice covering the chest like armor, cured-feared old-world weight",
  Meatball: "rounded warm-brown palette, familiar gentle smile, meatball-shaped silhouette, nonna's-kitchen comfort with a bruise underneath",
  "Roasted red pepper": "smoky charred-red palette, charming smoky smile, roasted-pepper sheen on the skin",
  Truffle: "rare dark earth palette, whispering pose, truffle slices fanned across the lapel, expensive secret aura",
  Artichoke: "armored green palette, stubborn old-roman stare, artichoke-leaf scales layered as wardrobe armor",
  Eggplant: "deep velvet purple palette, sicilian calm, glossy eggplant-skin sheen on the head/shoulders",
  "Broccoli rabe": "bitter green palette, honest weathered face, broccoli-rabe sprigs sprouting from the collar",
  "Chili crisp": "loud oily red-orange palette, modern reckless energy, chili-crisp flakes scattered across the face and shoulders, glossy spice glaze",
  Burrata: "luxurious soft-white palette, creamy soft smile, burrata milk gently spilling from the collar, indulgent calm",
  Oregano: "dried earthy green-brown palette, grandmotherly aura, dried oregano leaves dusted across the shoulders",
  Parmesan: "aged ivory-gold palette, sharp proud expression, parmesan-rind texture on the skin, crystalline age",
  Tomato: "ripe red palette flooding everything, the quiet boss of all toppings, tomato sheen on the face, foundational warmth",
  "Spicy salami": "hot cured-red palette, dangerous cured grin, spicy salami slice pinned huge to the lapel, hot-pepper flecks",
};

/** Used for a custom (free-text) topping: the text itself is never sent. */
export const GENERIC_MOTIF = "a small pizza slice pin on the lapel, warm tomato-red and cream palette, friendly neighborhood pizza-shop charm";
const GENERIC_TOPPING_LABEL = "a house-special pizza";

// MAFIA_FILMS tone tags -> mood phrase. A tag matches a rule when it contains
// one of the rule's keys (so "irish-italian" and "las vegas" both resolve).
// Rules are checked in order; the first matching tag of a film wins.
export const TONE_MOOD_RULES: { keys: string[]; mood: string }[] = [
  { keys: ["operatic", "epic", "patriarchal", "elegiac"], mood: "cinematic operatic gravitas, lodge-hall stillness" },
  { keys: ["sicilian", "cosa nostra", "calabria", "ndrangheta", "rome", "milan", "cousins"], mood: "old-country sicilian warmth, sun-faded social club" },
  { keys: ["naples", "camorra", "little italy", "greenwich"], mood: "naples back-alley warmth" },
  { keys: ["brooklyn", "queens", "bronx", "wiseguy", "irish-italian", "fugazi", "stoop", "new york", "lower east side", "hells kitchen", "puerto rican"], mood: "brooklyn corner-shop swagger" },
  { keys: ["noir", "heist", "melville", "lawmen", "mother fixation", "racetrack", "kubrick", "silent setpiece", "minimal", "cool"], mood: "moody noir shadows, single bare bulb" },
  { keys: ["yakuza", "tokyo", "okinawa", "hiroshima", "kitano", "meditative", "deadpan", "martial arts", "balletic", "stylized", "jakarta"], mood: "stoic poise, quiet ceremony" },
  { keys: ["triad", "hong kong", "moles", "tense", "undercover", "informant"], mood: "neon-tinted late-night cool" },
  { keys: ["prohibition", "pre-code", "cagney", "robinson", "classic", "depression-era", "30s-40s", "postwar", "chicago", "jewish mob", "nostalgic", "painterly"], mood: "1920s prohibition speakeasy hush" },
  { keys: ["miami", "cuban", "cocaine", "excess", "80s", "las vegas", "neon", "glamour", "high roller", "downfall", "dreamer", "ferrara", "pop", "costa del sol", "europop"], mood: "80s miami pastel heat, faded awning" },
  { keys: ["irish", "ira", "london", "cockney", "brit", "boston", "philly", "teamsters", "russian", "coen", "ethics", "political", "trial", "corruption"], mood: "neighborhood pub grit" },
  { keys: ["french", "paris", "corsican", "gabin", "outlaw", "audacious", "exile", "prison"], mood: "smoky cafe-noir cool" },
  { keys: ["rio", "favela", "youth", "verite", "copenhagen", "scandi", "raw", "gritty", "brutal"], mood: "rio street-corner heat" },
  { keys: ["harlem", "blaxploitation", "funk", "heroin", "crack era", "kingpin", "70s", "90s", "60s", "rise", "ascent", "ruthless", "scheme", "drug debt", "low-level", "tattoos", "cold", "menace", "retired", "regret", "tragic", "redemption", "betrayal", "loyalty", "honor", "mentor", "father-son", "coming of age", "robin hood", "explosive", "kinetic", "scorsese", "stylish"], mood: "1970s street-level hustle, flickering neon sign" },
];
export const DEFAULT_MOOD = "quiet pizza-lodge gravitas";

export const ANIMAL_FAMILIES = [
  "raccoon", "pigeon", "rat", "alley cat", "bulldog", "turtle",
  "crow", "fox", "possum", "duck", "frog", "sausage-smoking turkey",
  "scrappy neighborhood mutt", "mystic owl", "weary goat", "stout badger",
];

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic animal per name+topping so redraws and re-opens stay coherent. */
export function pickAnimal(name: string, topping: string): string {
  return ANIMAL_FAMILIES[hashString(`${name.toLowerCase()}|${topping}`) % ANIMAL_FAMILIES.length];
}

/** Canonical topping name (case-insensitive) or null for free text. */
export function canonicalTopping(topping: string): string | null {
  const t = topping.trim().toLowerCase();
  return PIZZA_TOPPINGS.find((k) => k.toLowerCase() === t) ?? null;
}

export function moodForFilm(filmId?: string | null): string {
  const film = filmId ? MAFIA_FILMS.find((f) => f.id === filmId) : undefined;
  for (const tag of film?.tone ?? []) {
    const t = tag.toLowerCase();
    const rule = TONE_MOOD_RULES.find((r) => r.keys.some((k) => t.includes(k)));
    if (rule) return rule.mood;
  }
  return DEFAULT_MOOD;
}

export function buildPortraitPrompt(input: { topping: string; filmId?: string | null; animal: string }): string {
  const canonical = canonicalTopping(input.topping);
  const label = canonical ?? GENERIC_TOPPING_LABEL;
  const motif = canonical ? TOPPING_MOTIF[canonical] : GENERIC_MOTIF;
  return `${STYLE}

TOPPING (THE IDENTITY — lead with this, it dominates the portrait): ${label}.
TOPPING PERSONALITY & VISUAL DOMINANCE: ${motif}.
ANIMAL VESSEL (commit to this species, no hybrids): ${input.animal}.
MAFIA COSTUME LAYER (atmosphere only, minimal): ${moodForFilm(input.filmId)}.
The topping must read first, the animal second, the mafia flavor third. Do NOT depict any real actor, human, or copyrighted character. Strictly an ingredient-led animal portrait.`;
}

/** Cache key for a drawn portrait: sha256(lower(name)|topping|film|variant). */
export function portraitCacheKey(input: { name: string; topping: string; filmKey: string; variant: number }): string {
  return createHash("sha256")
    .update(`${input.name.toLowerCase()}|${input.topping}|${input.filmKey}|${input.variant}`)
    .digest("hex");
}
