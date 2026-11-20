// app/lib/trivia/share.ts
//
// The text a member copies after answering the web daily (plans/trivia.md phase 3, "OG share"). It must never reveal the
// answer or the question: only the day, a result emoji line and the streak, plus the link.

export const SHARE_CORRECT_EMOJI = "🍕✅";
export const SHARE_WRONG_EMOJI = "🍕❌";

/** The result emoji line: pizza and a tick or a cross. Contains nothing from the question. */
export function shareEmojiLine(correct: boolean, streak: number | null | undefined): string {
  const base = correct ? SHARE_CORRECT_EMOJI : SHARE_WRONG_EMOJI;
  return streak && streak > 1 ? `${base} 🔥${streak}` : base;
}

/** The values for the translated share text ("Pizza Trivia {date} / {emojis} / {url}"). The answer is never one of them. */
export function shareValues(opts: { dayKey: string; correct: boolean; streak?: number | null; url: string }): { date: string; emojis: string; url: string } {
  return { date: opts.dayKey, emojis: shareEmojiLine(opts.correct, opts.streak), url: opts.url };
}
