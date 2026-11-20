// app/lib/trivia/bank-lint.ts
//
// Checks one question beyond the schema, with the real matcher: what CI used to run over the bank file. Used by every
// bank write (admin editor, import script). Pure.
import { match } from "./match";
import { QuestionSchema, type TriviaQuestion } from "./schema";

export type QuestionCheck = { ok: true; question: TriviaQuestion } | { ok: false; errors: string[] };

/** zod issues as short "path: message" lines. */
export function schemaErrors(value: unknown): QuestionCheck {
  const parsed = QuestionSchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "question"}: ${i.message}`) };
  return { ok: true, question: parsed.data };
}

/**
 * Matcher rules an approved question must meet (flagged / rejected drafts are only schema-checked):
 *  - its answer and every alias are accepted (and "yes" / "no" for a true/false question);
 *  - no reject is ever accepted;
 *  - for multiple choice, only the right choice wins, by text or by letter.
 */
export function lintQuestion(q: TriviaQuestion): string[] {
  if (q.status !== "approved") return [];
  const errors: string[] = [];
  const accepted = [q.answer, ...q.aliases];
  if (q.match.kind === "boolean") accepted.push(q.answer === "true" ? "yes" : "no");
  for (const a of accepted) if (match(q, a).verdict !== "correct") errors.push(`"${a}" should be accepted but is not`);
  for (const r of q.rejects) if (match(q, r).verdict === "correct") errors.push(`reject "${r}" is accepted`);
  if (q.type === "multiple_choice" && q.choices) {
    const letters = "abcd";
    q.choices.forEach((c, i) => {
      const expected = c === q.answer ? "correct" : "wrong";
      if (match(q, c).verdict !== expected) errors.push(`choice "${c}" should be ${expected}`);
      if (match(q, letters[i]).verdict !== expected) errors.push(`letter ${letters[i]} should be ${expected}`);
    });
  }
  return errors;
}

/** Schema + lint: the one check every bank write runs. */
export function checkQuestion(value: unknown): QuestionCheck {
  const s = schemaErrors(value);
  if (!s.ok) return s;
  const lint = lintQuestion(s.question);
  return lint.length ? { ok: false, errors: lint } : s;
}
