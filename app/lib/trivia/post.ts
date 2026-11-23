// app/lib/trivia/post.ts
//
// Discord message builders for the loop (plans/done/trivia.md section 6). Pure. Every message sets
// allowed_mentions explicitly: question and reveal posts ping nobody, the winner post pings only the winner.
// The question, reveal and explanation posts are embeds; the winner, too-late and cancelled posts stay plain text.
import { reveal } from "./bank";
import { FLAG_REACTION, ROUND_MINUTES, TF_REACTIONS } from "./config";
import type { ChoiceLabels } from "./emoji";
import type { TriviaQuestion } from "./schema";
import type { DiscordMessageBody } from "@/app/lib/discord-rest";

const TYPE_LABEL: Record<TriviaQuestion["type"], string> = {
  true_false: "True or false",
  short_answer: "Short answer",
  multiple_choice: "Multiple choice",
};

const NO_PINGS = { parse: [] as Array<"users" | "roles" | "everyone"> };

const COLOR = { question: 0xe8503a, reveal: 0xf39c12, answered: 0x2ecc71 } as const;
const DESCRIPTION_LIMIT = 4000;

/** Cut to `max` characters with an ellipsis. */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Discord timestamp markup: each reader sees their own local time. */
export function discordTime(at: Date, style: "t" | "R" = "t"): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:${style}>`;
}

/**
 * The question post: one embed (title, heading question, choices, how to answer, closing time, footer). The plain
 * content stays empty and nothing here reveals the answer. `rewardPep` 0 = a dry run: the title says nothing is paid.
 * Multiple-choice choices are prefixed with `labels.display` (the turtle emoji, or the regional indicators when one
 * is missing); the bot pre-adds the matching reactions right after posting, and true/false pre-adds the two below.
 * Typed answers keep working.
 */
export function questionMessage(q: TriviaQuestion, rewardPep: number, labels?: ChoiceLabels, closesAt?: Date): DiscordMessageBody {
  const title = rewardPep > 0 ? `🎲 Trivia Time · ${rewardPep} $PEP` : "🎲 Trivia (test round · nothing paid)";
  const lines: string[] = [];
  if (q.label) lines.push(`*${q.label}*`);
  lines.push(`### ${q.question}`, "");
  if (q.type === "true_false") lines.push(`${TF_REACTIONS.true} True   ·   ${TF_REACTIONS.false} False`);
  else if (q.choices) lines.push(...q.choices.map((c, i) => `${labels?.display[i] ?? `${String.fromCharCode(65 + i)}.`}  ${c}`));
  const how =
    q.type === "true_false"
      ? `React ${TF_REACTIONS.true} or ${TF_REACTIONS.false}, or type true / false`
      : q.type === "multiple_choice"
        ? "React with your pick, or type the answer"
        : "Type your answer";
  const closes = closesAt ? `Closes ${discordTime(closesAt)} (${discordTime(closesAt, "R")})` : `${ROUND_MINUTES} minutes`;
  lines.push("", how, "", `**⏳ ${closes}**`);
  const footer = `${TYPE_LABEL[q.type]} · ${q.difficulty} · first correct answer wins · react ${FLAG_REACTION} to report a bad question`;
  const embed = { title, description: clip(lines.join("\n"), DESCRIPTION_LIMIT), color: COLOR.question, footer: { text: footer } };
  return { content: "", embeds: [embed], allowed_mentions: NO_PINGS };
}

/** The answer card: optional headline, explanation, masked source link, and the question's photo if it has one. */
function answerEmbed(q: TriviaQuestion, title: string, headline: string | null, color: number) {
  const r = reveal(q);
  const url = r.sources[0]?.url;
  const parts: string[] = [];
  if (headline) parts.push(headline, "");
  parts.push(clip(r.explanation, 1200));
  if (url) {
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // keep the raw url as the link text
    }
    parts.push("", `Source: [${host}](${url})`);
  }
  const embed: Record<string, unknown> = { title, description: clip(parts.join("\n"), DESCRIPTION_LIMIT), color };
  if (r.image) embed.image = { url: r.image };
  return embed;
}

/** "Time's up" with the answer, the explanation and a source: nobody won. */
export function revealMessage(q: TriviaQuestion): DiscordMessageBody {
  const r = reveal(q);
  return { content: "", embeds: [answerEmbed(q, "⏰ Time's up!", `The answer: **${r.answer}**`, COLOR.reveal)], allowed_mentions: NO_PINGS };
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

/** After a win: the explanation and a source, one embed, no pings. */
export function explanationMessage(q: TriviaQuestion): DiscordMessageBody {
  const r = reveal(q);
  return { content: "", embeds: [answerEmbed(q, clip(`✅ The answer: ${r.answer}`, 250), null, COLOR.answered)], allowed_mentions: NO_PINGS };
}

export function cancelledMessage(): DiscordMessageBody {
  return { content: "🚫 Round cancelled. No $PEP was paid.", allowed_mentions: NO_PINGS };
}
