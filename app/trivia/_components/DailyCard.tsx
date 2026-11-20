"use client";

// Today's question: the same for everyone for a UTC day. One recorded attempt per Discord-signed-in member
// (for the streak); logged-out visitors can answer for fun and nothing is recorded.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { loginHrefFrom } from "@/app/lib/login-return";
import { paperCard, pillInk, pillOutline } from "@/app/ui/shared/Editorial";
import { shareValues } from "@/app/lib/trivia/share";
import { AnswerForm, postJson, QuestionHeader, RevealPanel, type PublicQuestionDto, type RevealDto } from "./shared";

interface DailyResponse {
  dayKey: string;
  resetsAt: string;
  signedIn: boolean;
  question: PublicQuestionDto;
  /** $PEP a correct answer pays today; 0 or absent when the reward is off. */
  rewardPep?: number;
  streak?: number | null;
  bestStreak?: number | null;
  attempt: { correct: boolean; reveal: RevealDto; percentCorrect: number | null } | null;
}
interface AnswerResponse {
  verdict?: "correct" | "wrong" | "ignore";
  /** Logged out while a reward is on offer: no verdict is given, only a prompt to sign in. */
  signInToAnswer?: boolean;
  alreadyAnswered?: boolean;
  recorded?: boolean;
  signInToReveal?: boolean;
  reveal?: RevealDto;
  percentCorrect?: number | null;
  streak?: number | null;
  bestStreak?: number | null;
  reward?: { pep: number; status: "paid" | "ineligible" | "off" | "already" | "error"; reason?: "not_member" | "too_young" };
}

function useCountdown(resetsAt: string | undefined): { h: number; m: number } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!resetsAt) return null;
  const ms = Math.max(0, Date.parse(resetsAt) - now);
  return { h: Math.floor(ms / 3_600_000), m: Math.floor((ms % 3_600_000) / 60_000) };
}

export default function DailyCard() {
  const t = useTranslations("trivia");
  const pathname = usePathname() || "/trivia";
  const [data, setData] = useState<DailyResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "none">("loading");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const [nudge, setNudge] = useState(false);
  const [needSignIn, setNeedSignIn] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [shared, setShared] = useState<"idle" | "copied" | "failed">("idle");
  const left = useCountdown(data?.resetsAt);

  useEffect(() => {
    let live = true;
    fetch("/api/trivia/daily", { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 503) return setState("none");
        if (!res.ok) return setState("error");
        setData((await res.json()) as DailyResponse);
        setState("ready");
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [reloadKey]);

  async function submit(answer: string) {
    setBusy(true);
    setNudge(false);
    // Send the day and question the member was shown: if the day rolled over meanwhile, the server refuses (409)
    // and records nothing, and we load the new question instead of grading the answer against it.
    const r = await postJson<AnswerResponse>("/api/trivia/daily", { answer, dayKey: data?.dayKey, questionId: data?.question.id });
    setBusy(false);
    if (r.status === 409) {
      setResult(null);
      setData(null);
      setState("loading");
      return setReloadKey((k) => k + 1);
    }
    if (!r.ok || !r.data) return setState("error");
    if (r.data.signInToAnswer) return setNeedSignIn(true);
    if (r.data.verdict === "ignore") return setNudge(true);
    setResult(r.data);
  }

  const answered = result && result.verdict !== "ignore" && result.reveal ? result : null;
  const prior = data?.attempt ?? null;
  const shown = answered
    ? { verdict: answered.verdict as "correct" | "wrong", reveal: answered.reveal!, pct: answered.percentCorrect ?? null, recorded: !!answered.recorded, already: !!answered.alreadyAnswered }
    : prior
      ? { verdict: (prior.correct ? "correct" : "wrong") as "correct" | "wrong", reveal: prior.reveal, pct: prior.percentCorrect, recorded: true, already: true }
      : null;
  // The reward line after a correct answer given just now (nothing at all when the reward is off).
  const reward = answered?.verdict === "correct" ? answered.reward : undefined;
  const rewardText =
    reward?.status === "paid"
      ? t("rewardPaid", { pep: reward.pep })
      : reward?.status === "already"
        ? t("rewardAlready")
        : reward?.status === "ineligible"
          ? t(reward.reason === "too_young" ? "rewardTooYoung" : "rewardNotMember")
          : reward?.status === "error"
            ? t("rewardError")
            : null;
  // A verdict with no answer text: logged out (sign in to see it) or not recorded (tables unavailable).
  const verdictOnly = result && result.verdict !== "ignore" && !result.reveal ? { verdict: result.verdict, signIn: !!result.signInToReveal } : null;
  const streak = answered?.streak ?? data?.streak ?? null;
  const bestStreak = Math.max(answered?.bestStreak ?? data?.bestStreak ?? 0, streak ?? 0);
  // Today's result, for the share text (the share text never contains the question or the answer).
  const todayCorrect = shown ? shown.verdict === "correct" : verdictOnly ? verdictOnly.verdict === "correct" : null;

  async function share() {
    if (!data || todayCorrect === null) return;
    const text = t("shareText", shareValues({ dayKey: data.dayKey, correct: todayCorrect, streak: data.signedIn ? streak : null, url: `${window.location.origin}/trivia` }));
    try {
      await navigator.clipboard.writeText(text);
      setShared("copied");
    } catch {
      setShared("failed");
    }
  }

  return (
    <section className={`${paperCard} p-6 sm:p-8`} aria-labelledby="trivia-daily-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="overline m-0 text-tomato-readable">{t("dailyOverline")}</p>
          <h2 id="trivia-daily-title" className="font-display mb-0 mt-1 text-xl font-black md:text-2xl">
            {t("dailyTitle")}
          </h2>
        </div>
        <div className="text-right text-sm text-foreground/70">
          {left && <p className="m-0">{t("resetsIn", { time: left.h > 0 ? t("timeHM", { h: left.h, m: left.m }) : t("timeM", { m: left.m }) })}</p>}
        </div>
      </div>

      {state === "ready" && data?.signedIn && streak !== null && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-[var(--radius)] bg-[hsl(var(--butter)/0.3)] px-4 py-3" role="group" aria-label={t("streakLabel")}>
          <p className="m-0 text-foreground">
            <span aria-hidden>🔥 </span>
            <span className="text-sm text-foreground/75">{t("streakCurrent")} </span>
            <strong className="font-display text-xl tabular-nums">{t("streakDays", { days: streak })}</strong>
          </p>
          <p className="m-0 text-foreground">
            <span className="text-sm text-foreground/75">{t("streakBest")} </span>
            <strong className="font-display text-xl tabular-nums">{t("streakDays", { days: bestStreak })}</strong>
          </p>
          {!shown && <p className="m-0 w-full text-sm text-foreground/75">{streak ? t("streakKeep") : t("streakStart")}</p>}
        </div>
      )}

      <div className="mt-5">
        {state === "loading" && <p className="m-0 text-foreground/70">{t("loading")}</p>}
        {state === "error" && (
          <p role="alert" className="m-0 text-tomato-readable">
            {t("loadError")}
          </p>
        )}
        {state === "none" && <p className="m-0 text-foreground/70">{t("noDaily")}</p>}
        {state === "ready" && data && (
          <>
            <QuestionHeader q={data.question} />
            {!shown && !verdictOnly && !!data.rewardPep && data.signedIn && (
              <p className="mb-2 mt-3 text-sm text-foreground/75">{t("rewardOffer", { pep: data.rewardPep })}</p>
            )}
            {!shown && !verdictOnly && <AnswerForm question={data.question} busy={busy} onSubmit={submit} />}
            {needSignIn && (
              <p role="alert" className="mb-0 mt-3 text-sm text-tomato-readable">
                {t("signInToAnswer", { pep: data.rewardPep ?? 0 })}
              </p>
            )}
            {nudge && (
              <p role="alert" className="mb-0 mt-3 text-sm text-tomato-readable">
                {t("notAnAnswer")}
              </p>
            )}
            {verdictOnly && (
              <div className={`${paperCard} mt-5 p-5`} role="status" aria-live="polite">
                <p className={`font-display m-0 text-xl font-black ${verdictOnly.verdict === "correct" ? "text-foreground" : "text-tomato-readable"}`}>
                  {verdictOnly.verdict === "correct" ? t("correct") : t("wrong")}
                </p>
                <p className="mb-0 mt-2 text-foreground/80">{verdictOnly.signIn ? t("signInToSeeAnswer") : t("notRecordedNoAnswer")}</p>
              </div>
            )}
            {shown && (
              <>
                <RevealPanel verdict={shown.verdict} reveal={shown.reveal} questionId={data.question.id} />
                <div className="mt-3 space-y-1 text-sm text-foreground/75">
                  {shown.already && <p className="m-0">{t("alreadyAnswered")}</p>}
                  {rewardText && (
                    <p className="m-0 font-semibold text-foreground" role="status">
                      {rewardText}
                    </p>
                  )}
                  {shown.pct !== null && <p className="m-0">{t("percentCorrect", { pct: shown.pct })}</p>}
                  {!shown.recorded && <p className="m-0">{t("notRecorded")}</p>}
                  <p className="m-0">{t("comeBack")}</p>
                </div>
              </>
            )}
            {todayCorrect !== null && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={share} className={pillInk}>
                  {t("shareButton")}
                </button>
                {shared === "copied" && (
                  <span role="status" className="text-sm text-foreground/75">
                    {t("shareCopied")}
                  </span>
                )}
                {shared === "failed" && (
                  <span role="alert" className="text-sm text-tomato-readable">
                    {t("shareFailed")}
                  </span>
                )}
              </div>
            )}
            {!data.signedIn && (
              <p className="mb-0 mt-5 flex flex-wrap items-center gap-3 text-sm text-foreground/75">
                <span>{t("streakPrompt")}</span>
                <Link href={loginHrefFrom(pathname)} className={pillOutline}>
                  {t("signIn")}
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
