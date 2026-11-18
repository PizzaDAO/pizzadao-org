"use client";

// Practice: ten random web-pool questions, unlimited, no rewards. Answers are checked on the server; the answer,
// explanation and sources only arrive in the reply to an attempt.
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FilterChip, paperCard, pillInk, pillTomato } from "@/app/ui/shared/Editorial";
import { AnswerForm, postJson, QuestionHeader, RevealPanel, type PublicQuestionDto, type RevealDto } from "./shared";

interface PracticeResponse {
  categories: { id: string; count: number }[];
  questions: PublicQuestionDto[];
}
interface CheckResponse {
  verdict: "correct" | "wrong" | "ignore";
  reveal?: RevealDto;
}

export default function PracticeCard() {
  const t = useTranslations("trivia");
  const [category, setCategory] = useState<string>("all");
  const [questions, setQuestions] = useState<PublicQuestionDto[] | null>(null);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<{ verdict: "correct" | "wrong"; reveal: RevealDto } | null>(null);
  const [nudge, setNudge] = useState(false);
  const [error, setError] = useState(false);
  const [done, setDone] = useState(false);

  async function start(cat: string) {
    setError(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/trivia/practice?category=${encodeURIComponent(cat)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as PracticeResponse;
      setQuestions(data.questions);
      setIndex(0);
      setScore(0);
      setChecked(null);
      setDone(false);
      setNudge(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function submit(answer: string) {
    const q = questions?.[index];
    if (!q) return;
    setBusy(true);
    setNudge(false);
    const r = await postJson<CheckResponse>("/api/trivia/practice", { questionId: q.id, answer });
    setBusy(false);
    if (!r.ok || !r.data) return setError(true);
    if (r.data.verdict === "ignore" || !r.data.reveal) return setNudge(true);
    if (r.data.verdict === "correct") setScore((s) => s + 1);
    setChecked({ verdict: r.data.verdict, reveal: r.data.reveal });
  }

  function next() {
    if (!questions) return;
    if (index + 1 >= questions.length) return setDone(true);
    setIndex(index + 1);
    setChecked(null);
    setNudge(false);
  }

  const q = questions?.[index];
  return (
    <section className={`${paperCard} p-6 sm:p-8`} aria-labelledby="trivia-practice-title">
      <p className="overline m-0 text-tomato-readable">{t("practiceOverline")}</p>
      <h2 id="trivia-practice-title" className="font-display mb-0 mt-1 text-xl font-black md:text-2xl">
        {t("practiceTitle")}
      </h2>
      <p className="mb-0 mt-2 text-foreground/70" style={{ fontSize: 15, lineHeight: 1.55 }}>
        {t("practiceDek")}
      </p>

      {error && (
        <p role="alert" className="mb-0 mt-4 text-tomato-readable">
          {t("loadError")}
        </p>
      )}

      {!questions && (
        <div className="mt-5">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("practiceTitle")}>
            <FilterChip label={t("allCategories")} active={category === "all"} onClick={() => setCategory("all")} />
            {PRACTICE_CATEGORIES.map((c) => (
              <FilterChip key={c} label={t(`categories.${c}` as "categories.pizza-day")} active={category === c} onClick={() => setCategory(c)} />
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void start(category)} className={`${pillTomato} mt-4`}>
            {busy ? t("loading") : t("startRound")}
          </button>
        </div>
      )}

      {questions && questions.length === 0 && (
        <div className="mt-5">
          <p className="m-0 text-foreground/70">{t("noQuestions")}</p>
          <button type="button" onClick={() => setQuestions(null)} className={`${pillInk} mt-3`}>
            {t("playAgain")}
          </button>
        </div>
      )}

      {questions && questions.length > 0 && done && (
        <div className="mt-5">
          <p className="font-display m-0 text-2xl font-black">{t("scoreLine", { score, total: questions.length })}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => void start(category)} className={pillTomato}>
              {t("playAgain")}
            </button>
            <button type="button" onClick={() => setQuestions(null)} className={pillInk}>
              {t("allCategories")}
            </button>
          </div>
        </div>
      )}

      {q && !done && (
        <div className="mt-5">
          <p className="overline m-0 mb-3 text-foreground/70">{t("questionOf", { n: index + 1, total: questions!.length })}</p>
          <QuestionHeader q={q} />
          {!checked && <AnswerForm key={q.id} question={q} busy={busy} onSubmit={submit} />}
          {nudge && (
            <p role="alert" className="mb-0 mt-3 text-sm text-tomato-readable">
              {t("notAnAnswer")}
            </p>
          )}
          {checked && (
            <>
              <RevealPanel verdict={checked.verdict} reveal={checked.reveal} questionId={q.id} />
              <button type="button" onClick={next} className={`${pillTomato} mt-4`}>
                {index + 1 >= questions!.length ? t("finish") : t("next")}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Practice filter chips. A category with no web questions shows the empty state. */
const PRACTICE_CATEGORIES = ["pizza-day", "jercos", "early-bitcoin", "satoshi", "protocol", "pizzadao", "myth-busting", "just-for-fun"] as const;
