// app/lib/trivia/schema.ts
//
// zod schema + types for the trivia question bank (data/trivia/questions.json). plans/trivia.md §3.1 and §4.2.
// The bank is validated once at load (bank.ts) and again in CI (bank.test.ts).
import { z } from "zod";

export const CATEGORIES = [
  "pizza-day",
  "jercos",
  "early-bitcoin",
  "satoshi",
  "protocol",
  "myth-busting",
  "pizzadao",
  "just-for-fun",
] as const;
export type TriviaCategory = (typeof CATEGORIES)[number];

export const QUESTION_TYPES = ["true_false", "short_answer", "multiple_choice"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const STATUSES = ["approved", "flagged", "needs_snax", "rejected"] as const;
export const MATCH_KINDS = ["boolean", "number", "text", "choice"] as const;

/**
 * Where an approved question may be served.
 *  - "discord": reserved for the Discord rounds (phase 2). Never served on the web (practice, daily),
 *    so nobody can farm Discord answers from the site.
 *  - "web": practice and the web daily only. Just-for-fun questions are always "web": never in paid rounds.
 */
export const POOLS = ["discord", "web"] as const;
export type TriviaPool = (typeof POOLS)[number];

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), "sources must be https");

const MatchSchema = z
  .object({
    kind: z.enum(MATCH_KINDS),
    fuzzy: z.boolean().optional(),
    tolerance: z.number().nonnegative().optional(),
  })
  .strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, "validUntil must be an ISO date");

export const QuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z]{2,4}-\d{3}$/, "id like pd-001"),
    category: z.enum(CATEGORIES),
    type: z.enum(QUESTION_TYPES),
    difficulty: z.enum(DIFFICULTIES),
    question: z.string().min(8).max(300),
    choices: z.array(z.string().min(1)).min(2).max(4).optional(),
    answer: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    rejects: z.array(z.string().min(1)).default([]),
    match: MatchSchema,
    explanation: z.string(),
    sources: z.array(z.object({ url: httpsUrl, note: z.string().min(1) }).strict()),
    notes: z.string().optional(),
    label: z.string().optional(),
    validUntil: isoDate.optional(),
    status: z.enum(STATUSES),
    pool: z.enum(POOLS).optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    const bad = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: "custom", message, path });

    // type <-> match.kind
    if (q.type === "true_false" && q.match.kind !== "boolean") bad("true_false needs match.kind boolean", ["match", "kind"]);
    if (q.type === "multiple_choice" && q.match.kind !== "choice") bad("multiple_choice needs match.kind choice", ["match", "kind"]);
    if (q.type === "short_answer" && !["number", "text"].includes(q.match.kind)) bad("short_answer needs match.kind number or text", ["match", "kind"]);

    if (q.match.kind === "boolean" && !["true", "false"].includes(q.answer)) bad('boolean answer must be "true" or "false"', ["answer"]);
    if (q.match.kind === "number" && !Number.isFinite(Number(q.answer))) bad("number answer must be numeric", ["answer"]);

    // choices belong to multiple choice only, and the answer is one of them
    if (q.type === "multiple_choice") {
      if (!q.choices) bad("multiple_choice needs choices", ["choices"]);
      else if (!q.choices.includes(q.answer)) bad("answer must be the exact text of one choice", ["answer"]);
    } else if (q.choices) bad("choices are for multiple_choice only", ["choices"]);

    // Rejected entries are kept only so they are not re-added; everything else is explained and sourced.
    if (q.status !== "rejected") {
      if (!q.explanation) bad("explanation required", ["explanation"]);
      if (q.sources.length === 0) bad("at least one source required", ["sources"]);
    }

    // Only approved questions are served, and every one of those says where.
    if (q.status === "approved" && !q.pool) bad("approved questions need a pool", ["pool"]);
    if (q.status !== "approved" && q.pool) bad("only approved questions have a pool", ["pool"]);
    // Fun questions (meme, not history) are web/practice only, never in paid Discord rounds.
    if ((q.id.startsWith("fun-") || q.category === "just-for-fun") && q.pool === "discord") bad("just-for-fun questions can never be in the discord pool", ["pool"]);
    if (q.category === "just-for-fun" && !q.label) bad("just-for-fun questions need a label banner", ["label"]);
  });

export type TriviaQuestion = z.infer<typeof QuestionSchema>;

export const BankSchema = z
  .object({
    version: z.number().int().positive(),
    verifiedAt: z.string(),
    notes: z.string().optional(),
    questions: z.array(QuestionSchema).min(1),
  })
  .strict()
  .superRefine((bank, ctx) => {
    const seen = new Set<string>();
    bank.questions.forEach((q, i) => {
      if (seen.has(q.id)) ctx.addIssue({ code: "custom", message: `duplicate id ${q.id}`, path: ["questions", i, "id"] });
      seen.add(q.id);
    });
  });

export type TriviaBank = z.infer<typeof BankSchema>;

/** What a client may see before it has attempted a question. Nothing in here reveals the answer. */
export interface PublicQuestion {
  id: string;
  category: TriviaCategory;
  type: TriviaQuestion["type"];
  difficulty: TriviaQuestion["difficulty"];
  question: string;
  choices?: string[];
  label?: string;
}

/** What a client sees after an attempt. */
export interface QuestionReveal {
  answer: string;
  explanation: string;
  sources: { url: string; note: string }[];
}
