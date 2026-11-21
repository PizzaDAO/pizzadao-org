// app/lib/trivia/emoji.ts
//
// Pure helpers for reaction answers (plans/done/trivia.md section 17): which emoji label the choices of a round, and
// which choice (or true/false) a reaction means. No I/O: the guild's emoji list is passed in.
import { CHOICE_EMOJI, CHOICE_FALLBACK, FLAG_REACTION, TF_REACTIONS } from "./config";
import type { TriviaQuestion } from "./schema";

/** A reaction as Discord reports it: a custom emoji has an id, a unicode one only a name. */
export interface ReactionEmoji {
  id: string | null;
  name: string | null;
}

export interface ChoiceLabels {
  /** How each choice is shown in the post: `<:1_leonardo:814...>` or a regional indicator. */
  display: string[];
  /** The same emoji as the REST path wants them for the bot's pre-added reactions: `name:id` or the unicode character. */
  reactions: string[];
  /** True when a turtle emoji was missing and the regional indicators are used for this round. */
  fallback: boolean;
}

/**
 * Labels for `count` choices. The turtles are used only when every one needed exists in the guild; otherwise (one was
 * deleted, or the guild's emoji could not be read, so we cannot tell) the regional indicators A-D are used for the
 * whole round, and `fallback` is true so the caller can log it.
 */
export function buildChoiceLabels(count: number, guildEmojiIds: ReadonlySet<string> | null): ChoiceLabels {
  const n = Math.max(0, Math.min(count, CHOICE_EMOJI.length));
  const turtles = CHOICE_EMOJI.slice(0, n);
  if (guildEmojiIds && turtles.every((e) => guildEmojiIds.has(e.id))) {
    return { display: turtles.map((e) => `<:${e.name}:${e.id}>`), reactions: turtles.map((e) => `${e.name}:${e.id}`), fallback: false };
  }
  const letters = CHOICE_FALLBACK.slice(0, n);
  return { display: [...letters], reactions: [...letters], fallback: true };
}

/** The reactions the bot pre-adds to a question post, in order: the picks, then the flag (every question has the flag). */
export function reactionsFor(q: Pick<TriviaQuestion, "type" | "choices">, labels: ChoiceLabels): string[] {
  const picks =
    q.type === "true_false"
      ? [TF_REACTIONS.true, TF_REACTIONS.false]
      : q.type === "multiple_choice"
        ? labels.reactions.slice(0, q.choices?.length ?? 0)
        : [];
  return [...picks, FLAG_REACTION];
}

/** The REST form of a reaction event's emoji (`name:id` or the unicode name). Null when it has no usable name. */
export function emojiToReaction(e: ReactionEmoji): string | null {
  if (e.id) return e.name ? `${e.name}:${e.id}` : null;
  return e.name || null;
}

/**
 * Which choice a reaction picks: the turtle with that id, or the regional indicator, by position. Both sets are
 * always accepted whichever one this round displayed, so nothing needs storing per round. Null for any other emoji.
 */
export function reactionChoiceIndex(e: ReactionEmoji, choiceCount: number): number | null {
  let idx = -1;
  if (e.id) idx = CHOICE_EMOJI.findIndex((c) => c.id === e.id);
  else if (e.name) idx = (CHOICE_FALLBACK as readonly string[]).indexOf(e.name);
  return idx >= 0 && idx < choiceCount ? idx : null;
}

/** ✅ = true, ❌ = false, anything else null. (Variation selectors are ignored: ❌ and ✅ sometimes arrive with one.) */
export function reactionBoolean(e: ReactionEmoji): boolean | null {
  if (e.id || !e.name) return null;
  const name = e.name.replace(/️/g, "");
  if (name === TF_REACTIONS.true) return true;
  if (name === TF_REACTIONS.false) return false;
  return null;
}

/**
 * Judge a reaction on a question: null when it is not a pick for this question (leave it alone), else whether it is
 * the right pick and a short label for the stored attempt. Only true/false and multiple choice take reactions.
 */
export function judgeReaction(q: TriviaQuestion, e: ReactionEmoji): { correct: boolean; label: string } | null {
  if (q.type === "true_false") {
    const given = reactionBoolean(e);
    return given === null ? null : { correct: given === (q.answer === "true"), label: given ? "true" : "false" };
  }
  if (q.type === "multiple_choice" && q.choices) {
    const idx = reactionChoiceIndex(e, q.choices.length);
    return idx === null ? null : { correct: q.choices[idx] === q.answer, label: String.fromCharCode(65 + idx) };
  }
  return null;
}
