// app/lib/trivia/exposed.ts
//
// "Exposed" questions: their text and answer are in the repo's public history (the bank used to be a JSON file in the
// public repo), so anyone can look the answer up. The web daily and the Discord rounds avoid them while an unexposed
// question is left; practice may serve them. Pure.
import { dailyQuestionFor } from "./daily";
import type { TriviaQuestion } from "./schema";

/**
 * The unexposed part of `candidates` when there is any, else all of them, with a warning: an exposed question beats no
 * question.
 */
export function preferUnexposed(candidates: readonly TriviaQuestion[], exposedIds: ReadonlySet<string>, what: string): TriviaQuestion[] {
  if (exposedIds.size === 0) return [...candidates];
  const fresh = candidates.filter((q) => !exposedIds.has(q.id));
  if (fresh.length > 0) return fresh;
  if (candidates.length > 0) console.warn(`[trivia] no unexposed question left for ${what}: using an exposed one (reword exposed questions in /admin/trivia)`);
  return [...candidates];
}

/**
 * The web daily for `dayKey`, preferring unexposed questions. With no exposed question in the pool this is exactly
 * dailyQuestionFor(dayKey, pool). Otherwise it picks among the unexposed questions not used as a daily recently (the last
 * floor(pool x 0.8) days, newest first in `recentIds`, today excluded), so a handful of reworded questions do not repeat
 * every day; when none is left it falls back to the not-recent rest (exposed ones), with a warning. Deterministic for
 * the same inputs, so every request of the day computes the same question.
 */
export function pickDailyQuestion(
  dayKey: string,
  pool: readonly TriviaQuestion[],
  { exposedIds, recentIds = [] }: { exposedIds: ReadonlySet<string>; recentIds?: readonly string[] },
): TriviaQuestion | null {
  if (pool.length === 0) return null;
  if (!pool.some((q) => exposedIds.has(q.id))) return dailyQuestionFor(dayKey, [...pool]);
  const avoid = new Set(recentIds.slice(0, Math.floor(pool.length * 0.8)));
  const fresh = pool.filter((q) => !exposedIds.has(q.id) && !avoid.has(q.id));
  if (fresh.length > 0) return dailyQuestionFor(dayKey, fresh);
  console.warn("[trivia] no unexposed question left for the web daily: using an exposed one (reword exposed questions in /admin/trivia)");
  const notRecent = pool.filter((q) => !avoid.has(q.id));
  return dailyQuestionFor(dayKey, notRecent.length > 0 ? notRecent : [...pool]);
}
