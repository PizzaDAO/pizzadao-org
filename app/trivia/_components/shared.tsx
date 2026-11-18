"use client";

// Building blocks shared by the daily card and practice: the answer form, the reveal and "report a problem".
import { useState } from "react";
import { useTranslations } from "next-intl";
import { paperCard, pillInk, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";

export interface PublicQuestionDto {
  id: string;
  category: string;
  type: "true_false" | "short_answer" | "multiple_choice";
  difficulty: "easy" | "medium" | "hard";
  question: string;
  choices?: string[];
  label?: string;
}

export interface RevealDto {
  answer: string;
  explanation: string;
  sources: { url: string; note: string }[];
}

export type Verdict = "correct" | "wrong" | "ignore";

export const inputClass =
  "w-full min-h-11 rounded-[var(--radius)] border border-[hsl(var(--rule-warm)/0.65)] bg-background px-3 py-2 text-base text-foreground placeholder:text-foreground/45 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/0.4)]";

/** POST JSON and parse the reply; never throws (network failures come back as ok: false). */
export async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export function QuestionHeader({ q }: { q: PublicQuestionDto }) {
  const t = useTranslations("trivia");
  return (
    <div>
      {q.label && (
        <p className="m-0 mb-2 inline-block rounded-full bg-[hsl(var(--butter)/0.45)] px-3 py-1 text-[13px] font-semibold text-foreground">{q.label}</p>
      )}
      <p className="overline m-0 text-foreground/70">
        {t(`categories.${q.category}` as "categories.pizza-day")} · {t(`difficulty.${q.difficulty}`)}
      </p>
      <h3 className="font-display mt-2 mb-0 text-2xl font-black leading-tight tracking-tight text-foreground" style={{ textWrap: "balance" }}>
        {q.question}
      </h3>
    </div>
  );
}

/** True/false buttons, multiple-choice buttons or a text box, depending on the question. */
export function AnswerForm({
  question,
  busy,
  onSubmit,
}: {
  question: PublicQuestionDto;
  busy: boolean;
  onSubmit: (answer: string) => void;
}) {
  const t = useTranslations("trivia");
  const [text, setText] = useState("");

  if (question.type === "true_false") {
    return (
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" disabled={busy} onClick={() => onSubmit("true")} className={`${pillInk} justify-center`}>
          {t("trueLabel")}
        </button>
        <button type="button" disabled={busy} onClick={() => onSubmit("false")} className={`${pillOutline} justify-center`}>
          {t("falseLabel")}
        </button>
      </div>
    );
  }
  if (question.type === "multiple_choice" && question.choices) {
    return (
      <ul className="m-0 mt-5 grid list-none gap-2 p-0">
        {question.choices.map((c, i) => (
          <li key={c}>
            <button type="button" disabled={busy} onClick={() => onSubmit(c)} className={`${pillOutline} w-full justify-start text-left`}>
              <span aria-hidden className="mr-2 font-black text-tomato-readable">
                {"ABCD"[i]}
              </span>
              {c}
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <form
      className="mt-5 flex flex-wrap gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text.trim());
      }}
    >
      <label className="sr-only" htmlFor={`trivia-answer-${question.id}`}>
        {t("answerLabel")}
      </label>
      <input
        id={`trivia-answer-${question.id}`}
        className={`${inputClass} min-w-0 flex-1`}
        value={text}
        maxLength={120}
        autoComplete="off"
        placeholder={t("answerPlaceholder")}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <button type="submit" disabled={busy || !text.trim()} className={pillTomato}>
        {busy ? t("checking") : t("submit")}
      </button>
    </form>
  );
}

export function RevealPanel({ verdict, reveal, questionId }: { verdict: "correct" | "wrong"; reveal: RevealDto; questionId: string }) {
  const t = useTranslations("trivia");
  return (
    <div className={`${paperCard} mt-5 p-5`} role="status" aria-live="polite">
      <p className={`font-display m-0 text-xl font-black ${verdict === "correct" ? "text-foreground" : "text-tomato-readable"}`}>
        {verdict === "correct" ? t("correct") : t("wrong")}
      </p>
      <p className="mb-0 mt-2 font-semibold text-foreground">{t("theAnswerIs", { answer: reveal.answer })}</p>
      <p className="mb-0 mt-2 text-foreground/80" style={{ lineHeight: 1.55 }}>
        {reveal.explanation}
      </p>
      {reveal.sources.length > 0 && (
        <div className="mt-3">
          <p className="overline m-0 text-foreground/70">{t("sources")}</p>
          <ul className="m-0 mt-1 list-none space-y-1 p-0 text-sm">
            {reveal.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-tomato-readable underline underline-offset-2">
                  {hostOf(s.url)}
                </a>
                <span className="text-foreground/70">: {s.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ReportProblem questionId={questionId} />
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** "Report a problem with this question" -> POST /api/trivia/report (visible in /admin/trivia). */
export function ReportProblem({ questionId }: { questionId: string }) {
  const t = useTranslations("trivia");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  if (state === "done") return <p className="mb-0 mt-4 text-sm text-foreground/70">{t("reportThanks")}</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 cursor-pointer border-0 bg-transparent p-0 text-sm text-foreground/70 underline underline-offset-2">
        {t("reportLink")}
      </button>
    );
  }
  return (
    <form
      className="mt-4 grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending");
        const r = await postJson("/api/trivia/report", { questionId, text });
        setState(r.ok ? "done" : "error");
      }}
    >
      <label className="sr-only" htmlFor={`trivia-report-${questionId}`}>
        {t("reportLink")}
      </label>
      <textarea
        id={`trivia-report-${questionId}`}
        className={`${inputClass} min-h-20`}
        value={text}
        maxLength={500}
        placeholder={t("reportPlaceholder")}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={state === "sending" || text.trim().length < 3} className={pillInk}>
          {state === "sending" ? t("reportSending") : t("reportSend")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={pillOutline}>
          {t("cancel")}
        </button>
        {state === "error" && (
          <span role="alert" className="text-sm text-tomato-readable">
            {t("reportError")}
          </span>
        )}
      </div>
    </form>
  );
}
