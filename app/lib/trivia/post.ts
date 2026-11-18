// app/lib/trivia/post.ts
//
// Discord message builders for the loop (plans/trivia.md section 6). Pure. Every message sets
// allowed_mentions explicitly: question and reveal posts ping nobody, the winner post pings only the winner.
import { reveal } from "./bank";
import { ROUND_MINUTES } from "./config";
import type { TriviaQuestion } from "./schema";
import { DISCORD_MESSAGE_LIMIT, type DiscordMessageBody } from "@/app/lib/discord-rest";

const CHOICE_EMOJI = ["🅰️", "🅱️", "🅲", "🅳"] as const;
const TYPE_LABEL: Record<TriviaQuestion["type"], string> = {
  true_false: "true or false",
  short_answer: "short answer",
  multiple_choice: "multiple choice",
};

const NO_PINGS = { parse: [] as Array<"users" | "roles" | "everyone"> };

/** Cut to `max` characters with an ellipsis. */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Keep a post under Discord's limit whatever the explanation says. */
function fit(content: string): string {
  return clip(content, DISCORD_MESSAGE_LIMIT - 20);
}

/** The question post. `rewardPep` 0 = a dry run: the post says nothing is paid. */
export function questionMessage(q: TriviaQuestion, rewardPep: number): DiscordMessageBody {
  const head =
    rewardPep > 0
      ? `🎲 Trivia Time! First to answer correctly wins ${rewardPep} $PEP:`
      : "🎲 Trivia test round (nothing is paid). First to answer correctly wins bragging rights:";
  const lines = [head];
  if (q.label) lines.push(q.label);
  lines.push(`**${q.question}**`);
  if (q.choices) lines.push(...q.choices.map((c, i) => `${CHOICE_EMOJI[i] ?? `${i + 1}.`} ${c}`));
  lines.push(`(${TYPE_LABEL[q.type]} · ${q.difficulty} · ${ROUND_MINUTES} min)`);
  return { content: fit(lines.join("\n")), allowed_mentions: NO_PINGS };
}

/** First source link, wrapped in <> so Discord shows no preview. */
function sourceLine(q: TriviaQuestion): string | null {
  const url = reveal(q).sources[0]?.url;
  return url ? `Source: <${url}>` : null;
}

/** "Time's up" with the answer, the explanation and a source: nobody won. */
export function revealMessage(q: TriviaQuestion): DiscordMessageBody {
  const r = reveal(q);
  const lines = [`⏰ Time's up! The answer was **${r.answer}**.`, clip(r.explanation, 1200), sourceLine(q)];
  return { content: fit(lines.filter(Boolean).join("\n")), allowed_mentions: NO_PINGS };
}

/** The winner post, sent as a reply to the winning message. */
export function winnerMessage(discordId: string, rewardPep: number, paid: boolean, winnerMessageId: string): DiscordMessageBody {
  const prize = paid && rewardPep > 0 ? ` ${rewardPep} $PEP` : "";
  const note = !paid || rewardPep === 0 ? " (test round: nothing paid)" : "";
  return {
    content: `✅ Correct! <@${discordId}> wins${prize}!${note}`,
    allowed_mentions: { parse: [], users: [discordId] },
    message_reference: { message_id: winnerMessageId, fail_if_not_exists: false },
  };
}

/** After a win: the explanation and a source, one message, no pings. */
export function explanationMessage(q: TriviaQuestion): DiscordMessageBody {
  const r = reveal(q);
  const lines = [`The answer: **${r.answer}**`, clip(r.explanation, 1200), sourceLine(q)];
  return { content: fit(lines.filter(Boolean).join("\n")), allowed_mentions: NO_PINGS };
}

/** A correct answer that cannot win: said once, as a reply, pings the member. */
export function notEligibleMessage(discordId: string, reason: "not_member" | "too_young" | "daily_cap", messageId: string): DiscordMessageBody {
  const text =
    reason === "not_member"
      ? "Correct! Join PizzaDAO at https://pizzadao.org/join to collect $PEP next time."
      : reason === "too_young"
        ? "Correct! $PEP prizes need a Discord account at least 7 days old; keep playing."
        : "Correct! You have hit today's limit of 3 trivia wins, so this one stays open for others.";
  return {
    content: `✅ <@${discordId}> ${text}`,
    allowed_mentions: { parse: [], users: [discordId] },
    message_reference: { message_id: messageId, fail_if_not_exists: false },
  };
}

export function cancelledMessage(): DiscordMessageBody {
  return { content: "🚫 Round cancelled. No $PEP was paid.", allowed_mentions: NO_PINGS };
}
