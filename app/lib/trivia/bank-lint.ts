// app/lib/trivia/bank-lint.ts
//
// Checks one question beyond the schema, with the real matcher: what CI used to run over the bank file. Used by every
// bank write (admin editor, import script). Pure.
//
// Every message names a field and an index only, never a value: these lines end up in terminal output and logs, and
// the values are answers, aliases and rejects.
import { match } from "./match";
import { QuestionSchema, type TriviaQuestion } from "./schema";

export type QuestionCheck = { ok: true; question: TriviaQuestion } | { ok: false; errors: string[] };

/**
 * Schema issues as "path: code" lines (zod's codes, not its messages: an enum message quotes the value it received).
 * Custom rule messages (they never contain values) are kept.
 */
export function schemaErrors(value: unknown): QuestionCheck {
  const parsed = QuestionSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "question"}: ${i.code === "custom" ? i.message : i.code}`) };
  }
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
  if (match(q, q.answer).verdict !== "correct") errors.push("answer: not accepted by the matcher");
  q.aliases.forEach((a, i) => {
    if (match(q, a).verdict !== "correct") errors.push(`aliases[${i}]: not accepted by the matcher`);
  });
  if (q.match.kind === "boolean" && match(q, q.answer === "true" ? "yes" : "no").verdict !== "correct") errors.push("answer: yes/no form not accepted");
  q.rejects.forEach((r, i) => {
    if (match(q, r).verdict === "correct") errors.push(`rejects[${i}]: accepted by the matcher`);
  });
  if (q.type === "multiple_choice" && q.choices) {
    const letters = "abcd";
    q.choices.forEach((c, i) => {
      const expected = c === q.answer ? "correct" : "wrong";
      if (match(q, c).verdict !== expected) errors.push(`choices[${i}]: text should be ${expected}`);
      if (match(q, letters[i]).verdict !== expected) errors.push(`choices[${i}]: letter should be ${expected}`);
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
