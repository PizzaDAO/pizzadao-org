// Prompts for the dough-ball review set. Pure and deterministic: candidate i always gets the same traits,
// so runs are comparable. Candidate 0 is the owner's favorite (saluting, winking, flour-dusted apron,
// oversized fedora). Expressions stay friendly, eager or mischievous, never angry.

export const BASE_DESCRIPTION =
  "Create an original cartoon mafia character: the newest recruit of a pizza crime family, who is a round ball of raw pizza dough that hasn't been shaped into a pizza yet. The dough ball IS the character's head and body (soft, pale, slightly floury dough with a smooth stretchy texture), with a small face, stubby little arms, and tiny feet. Bold, polished 2D cartoon illustration, collectible-character aesthetic, clean outlines, rich colors; playful and charming with a hint of wannabe-gangster attitude, never angry. Mafia touches sized for a beginner: fedora with a tomato-red (#F83A3A) hatband, small tie or vest. Single centered character, whole character and hat visible, works as a round profile picture, simple flat warm cream background. No text, logos or watermarks."

export type Traits = { expression: string; pose: string; outfit: string; accessory: string }

export const EXPRESSIONS = [
  "a cheeky wink with an eager grin",
  "a wide, eager smile with sparkling eyes",
  "a mischievous smirk with one raised eyebrow",
  "a proud, beaming smile",
  "a friendly, slightly nervous grin, eager to impress",
  "a playful, sly smile with a twinkle in the eye",
]

export const POSES = [
  "giving a crisp salute with one stubby arm",
  "tipping the fedora with one hand",
  "standing with hands on hips, chest out proudly",
  "giving a thumbs up",
  "waving hello",
]

export const OUTFITS = [
  "a flour-dusted apron",
  "a small pinstripe vest",
  "a tiny tie and suspenders",
  "an oversized trench coat that is a bit too big",
]

export const ACCESSORIES = [
  "an oversized fedora",
  "a standard fedora worn slightly tilted",
  "a fedora and a tiny rolling pin tucked under one arm",
  "a fedora and a red carnation on the lapel",
  "a fedora and a small golden pizza-cutter pendant",
  "an oversized fedora and a toothpick in the corner of the mouth",
  "a fedora and a tiny flour-covered pizza peel",
]

/** Deterministic traits for candidate `index` (0-based). Candidate 0 is the owner's favorite combination. */
export function traitsFor(index: number): Traits {
  return {
    expression: EXPRESSIONS[index % EXPRESSIONS.length],
    pose: POSES[index % POSES.length],
    outfit: OUTFITS[index % OUTFITS.length],
    accessory: ACCESSORIES[index % ACCESSORIES.length],
  }
}

export function promptFor(traits: Traits): string {
  return `${BASE_DESCRIPTION}\n\nThis version: expression: ${traits.expression}; pose: ${traits.pose}; outfit: ${traits.outfit}; accessory: ${traits.accessory}. Keep the expression friendly, eager or mischievous, never angry or scowling.`
}

export function buildCandidates(count: number, startIndex = 0): Array<{ position: number; traits: Traits; prompt: string }> {
  return Array.from({ length: count }, (_, i) => {
    const position = startIndex + i
    const traits = traitsFor(position)
    return { position, traits, prompt: promptFor(traits) }
  })
}
