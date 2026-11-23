// app/lib/trivia/post.ts
//
// Discord message builders for the loop (plans/done/trivia.md section 6). Pure. Every message sets
// allowed_mentions explicitly: question and reveal posts ping nobody, the winner post pings only the winner.
import { reveal } from "./bank";
import { FLAG_REACTION, ROUND_MINUTES, TF_REACTIONS } from "./config";
import type { ChoiceLabels } from "./emoji";
import type { TriviaQuestion } from "./schema";
import { DISCORD_MESSAGE_LIMIT, type DiscordMessageBody } from "@/app/lib/discord-rest";

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

/** Discord timestamp markup: each reader sees their own local time. */
export function discordTime(at: Date, style: "t" | "R" = "t"): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:${style}>`;
}

function closesText(closesAt: Date): string {
  return `closes ${discordTime(closesAt)} (${discordTime(closesAt, "R")})`;
}

/**
 * The question post. `rewardPep` 0 = a dry run: the post says nothing is paid. Multiple-choice choices are prefixed
 * with `labels.display` (the turtle emoji, or the regional indicators when one is missing); the bot pre-adds the
 * matching reactions right after posting, and true/false pre-adds the two below. Typed answers keep working.
 */
export function questionMessage(q: TriviaQuestion, rewardPep: number, labels?: ChoiceLabels, closesAt?: Date): DiscordMessageBody {
  const head =
    rewardPep > 0
      ? `🎲 Trivia Time! First to answer correctly wins ${rewardPep} $PEP:`
      : "🎲 Trivia test round (nothing is paid). First to answer correctly wins bragging rights:";
  const lines = [head];
  if (q.label) lines.push(q.label);
  lines.push(`**${q.question}**`);
  if (q.choices) lines.push(...q.choices.map((c, i) => `${labels?.display[i] ?? `${String.fromCharCode(65 + i)}.`} ${c}`));
  const how =
    q.type === "true_false"
      ? ` · react ${TF_REACTIONS.true} or ${TF_REACTIONS.false}, or type true / false`
      : q.type === "multiple_choice"
        ? " · react with your pick, or type the answer"
        : "";
  lines.push(`(${TYPE_LABEL[q.type]} · ${q.difficulty} · ${closesAt ? closesText(closesAt) : `${ROUND_MINUTES} min`}${how} · ${FLAG_REACTION} reports a bad question)`);
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

/** Reply to a correct answer that arrived after the round closed (nobody is pinged). */
export function tooLateMessage(closesAt: Date, answerMessageId: string): DiscordMessageBody {
  return {
    content: `⌛ Too late, the round closed at ${discordTime(closesAt)}.`,
    allowed_mentions: NO_PINGS,
    message_reference: { message_id: answerMessageId, fail_if_not_exists: false },
  };
}

/** After a win: the explanation and a source, one message, no pings. */
export function explanationMessage(q: TriviaQuestion): DiscordMessageBody {
  const r = reveal(q);
  const lines = [`The answer: **${r.answer}**`, clip(r.explanation, 1200), sourceLine(q)];
  return { content: fit(lines.filter(Boolean).join("\n")), allowed_mentions: NO_PINGS };
}

export function cancelledMessage(): DiscordMessageBody {
  return { content: "🚫 Round cancelled. No $PEP was paid.", allowed_mentions: NO_PINGS };
}
