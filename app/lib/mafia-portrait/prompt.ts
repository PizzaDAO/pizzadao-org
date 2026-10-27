// app/lib/mafia-portrait/prompt.ts
// Prompt builder for the finale portrait (plans/mafia-name-port.md, Phase 1).
//
// The template is Snax's character-generator guide, used essentially verbatim.
// The member's chosen mafia name is the only free text that reaches it, and
// only after sanitizeCharacterName. Turtle colors and the crew prop come from
// fixed server-side maps keyed by validated ids, never from request text.
import { createHash } from "crypto";
import { normalizeCrewId } from "@/app/lib/crew-id";

/** Strip anything that could break out of the quoted name slot. */
export function sanitizeCharacterName(input: unknown): string {
  return String(input ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/["'`\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f\u00ab\u00bb*#<>{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
}

// Canonical order; also decides which colors win when a member has many turtles.
export const TURTLE_COLORS: Record<string, string> = {
  Leonardo: "blue",
  Raphael: "red",
  Donatello: "purple",
  Michelangelo: "orange",
  April: "yellow",
  Splinter: "brown",
};

/** Known turtles only (case-insensitive), deduped, in canonical order. */
export function canonicalTurtles(input: unknown): string[] {
  const wanted = new Set(
    (Array.isArray(input) ? input : []).map((x) => String(x ?? "").trim().toLowerCase()),
  );
  return Object.keys(TURTLE_COLORS).filter((t) => wanted.has(t.toLowerCase()));
}

/** [hatband, tie, pocket square] colors, or null with no turtles. */
export function accentColors(turtles: string[]): [string, string, string] | null {
  const c = turtles.map((t) => TURTLE_COLORS[t]).filter(Boolean);
  if (c.length === 0) return null;
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 2) return [c[0], c[1], c[0]];
  return [c[0], c[1], c[2]];
}

// Crew id (crew-mappings slug) -> the one prop the character carries.
// Crews not listed here (e.g. regional ones) get no prop.
export const CREW_PROPS: Record<string, string> = {
  ops: "a clipboard",
  tech: "a briefcase made of a circuit board",
  comms: "a vintage microphone",
  events: "a megaphone and a handful of party poppers",
  design: "a paint brush",
  design_art: "a paint brush",
  creative: "a paint brush",
  biz_dev: "a briefcase stuffed with contracts",
  education: "a stack of old books",
  music: "a battered trumpet",
  governance: "a judge's gavel",
  real_estate: "a ring of keys",
  community: "a pizza box tucked under one arm",
};

/** Known crews only, deduped, sorted (so the prop and cache key are order-independent). */
export function canonicalCrews(input: unknown): string[] {
  const ids = (Array.isArray(input) ? input : [])
    .map((x) => normalizeCrewId(x))
    .filter((id) => id in CREW_PROPS);
  return [...new Set(ids)].sort();
}

export function propForCrews(crews: string[]): string | null {
  return crews.length ? CREW_PROPS[crews[0]] : null;
}

export type PortraitInput = { name: string; turtles?: unknown; crews?: unknown };

/** Throws on an empty name: callers must have validated already. */
export function buildPortraitPrompt(input: PortraitInput): string {
  const name = sanitizeCharacterName(input.name);
  if (!name) throw new Error("empty character name");
  const colors = accentColors(canonicalTurtles(input.turtles));
  const prop = propForCrews(canonicalCrews(input.crews));

  const accentLine = colors
    ? `\n- Accent colors: hatband ${colors[0]}, tie ${colors[1]}, pocket square ${colors[2]}.`
    : "";
  const propLine = prop ? `\n- The character carries ${prop} as one of their accessories.` : "";

  return `Create an original cartoon mafia character named **"${name}"**.

**Character concept**
Interpret the name creatively to design a memorable, visually distinctive mobster. Use the name's meaning, wordplay, cultural associations, personality, and imagery to inspire the character's appearance. If the name suggests an animal, food, object, profession, or recognizable archetype, incorporate that concept directly into the character's anatomy, costume, or accessories.

**Visual style**
- Bold, polished 2D cartoon illustration with a cohesive, collectible-character aesthetic.
- Expressive facial features, exaggerated proportions, and a strong, instantly recognizable silhouette.
- Clean, confident outlines, smooth shapes, rich colors, and carefully controlled shading.
- Playful, charismatic, and slightly intimidating, balancing organized-crime attitude with cartoon humor.
- Professional character-design quality, not photorealistic or generic AI fantasy artwork.

**Mafia aesthetic**
- Draw inspiration from classic American and Italian gangster imagery.
- Incorporate appropriate mobster clothing such as tailored suits, pinstripe jackets, fedoras with contrasting hatbands, ties, dress shirts, waistcoats, or overcoats.
- Choose a distinctive color palette and accent colors appropriate to the character concept.${accentLine}
- Add personality through facial expressions, posture, and one or two carefully chosen accessories.${propLine}
- The character should look like a member of a colorful cartoon mafia family, not simply a person wearing a costume.

**Creative interpretation**
- Prioritize clever visual storytelling over literal interpretation.
- When appropriate, transform the character's actual head, face, or body into an element suggested by the name, rather than merely having the character hold that element.
- Blend unusual anatomical elements naturally into the cartoon design.
- Give the character a memorable attitude: smug, mischievous, calculating, threatening, charming, eccentric, or comically self-important.
- Avoid repetitive designs, generic human faces, and defaulting to the same suit and pose for every character.
- Each new character must be unique but visually compatible with the rest of the collection.

**Composition**
- Show a single character, centered, with the entire head, hat, and important costume details clearly visible.
- Use a three-quarter or full-body composition as appropriate to communicate the character concept.
- Create a clear silhouette suitable for a collectible character portrait or profile image.
- Use a simple, unobtrusive background so the character remains the focus.
- Do not crop important accessories or anatomical features.

**Output requirements**
- One finished character illustration.
- Consistent quality and rendering style across the collection.
- No lettering, labels, captions, logos, watermarks, or typography.
- The character's identity should be conveyed visually without needing to read the name.

**Character name:** ${name}`;
}

/**
 * Cache key for a drawn portrait: sha256 of everything that shapes the prompt
 * (lowercased name, canonical sorted turtles and crews) plus the redraw variant.
 */
export function portraitCacheKey(input: PortraitInput & { variant: number }): string {
  const name = sanitizeCharacterName(input.name).toLowerCase();
  const turtles = canonicalTurtles(input.turtles).join(",");
  const crews = canonicalCrews(input.crews).join(",");
  return createHash("sha256")
    .update(`v2|${name}|${turtles}|${crews}|${input.variant}`)
    .digest("hex");
}
