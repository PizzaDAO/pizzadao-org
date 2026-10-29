/**
 * The built-in /work replies and the env override. Pure data (no database import), so the settings
 * registry can use it as the code default.
 */

export const DEFAULT_WORK_PROMPTS: readonly string[] = [
  "You tossed dough for the crew and earned {amount}. Bonus mission: invite a friend to this week's [community call](<https://app.pizzadao.org/calls>) and tag a mod for a 314 bonus.",
  'You folded pizza boxes all shift: {amount}. Bonus mission: share your best pizza gif in the gifs channel for a 69-314 bonus.',
  'You delivered a pie across town and earned {amount}. Bonus mission: post a photo of a local pizzeria to earn a bonus.',
  'You grated mountains of mozzarella: {amount}. Bonus mission: welcome a new member in general.',
  'You tended the wood-fired oven and earned {amount}. Bonus mission: claim a task on [app.pizzadao.org](<https://app.pizzadao.org/crews>).',
  'You pitched a Global Pizza Party venue and earned {amount}. Bonus mission: help plan a party in your city on [rsv.pizza](<https://rsv.pizza>).',
]

/** The WORK_PROMPTS_JSON replies when set and valid (a non-empty JSON array of strings); null otherwise. */
export function parseWorkPromptsEnv(raw: string | undefined): readonly string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length && parsed.every((p) => typeof p === 'string')) return parsed
  } catch {
    /* fall through */
  }
  return null
}

/** What is in force when nothing is saved: the env replies if set and valid, else the built-in ones. */
export function workPromptsBaseline(raw: string | undefined = process.env.WORK_PROMPTS_JSON): readonly string[] {
  return parseWorkPromptsEnv(raw) ?? DEFAULT_WORK_PROMPTS
}
