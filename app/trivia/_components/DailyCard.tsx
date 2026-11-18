"use client";

// Today's question: the same for everyone for a UTC day. One recorded attempt per Discord-signed-in member
// (for the streak); logged-out visitors can answer for fun and nothing is recorded.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { loginHrefFrom } from "@/app/lib/login-return";
import { paperCard, pillOutline } from "@/app/ui/shared/Editorial";
import { AnswerForm, postJson, QuestionHeader, RevealPanel, type PublicQuestionDto, type RevealDto } from "./shared";

interface DailyResponse {
  dayKey: string;
  resetsAt: string;
  signedIn: boolean;
  question: PublicQuestionDto;
  streak?: number | null;
  attempt: { correct: boolean; reveal: RevealDto; percentCorrect: number | null } | null;
}
interface AnswerResponse {
  verdict: "correct" | "wrong" | "ignore";
  alreadyAnswered?: boolean;
  recorded?: boolean;
  reveal?: RevealDto;
  percentCorrect?: number | null;
  streak?: number | null;
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
  }, []);

  async function submit(answer: string) {
    setBusy(true);
    setNudge(false);
    const r = await postJson<AnswerResponse>("/api/trivia/daily", { answer });
    setBusy(false);
    if (!r.ok || !r.data) return setState("error");
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
  const streak = answered?.streak ?? data?.streak ?? null;

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
          {data?.signedIn && streak !== null && streak !== undefined && <p className="m-0 font-semibold text-foreground">{t("streak", { days: streak })}</p>}
        </div>
      </div>

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
            {!shown && <AnswerForm question={data.question} busy={busy} onSubmit={submit} />}
            {nudge && (
              <p role="alert" className="mb-0 mt-3 text-sm text-tomato-readable">
                {t("notAnAnswer")}
              </p>
            )}
            {shown && (
              <>
                <RevealPanel verdict={shown.verdict} reveal={shown.reveal} questionId={data.question.id} />
                <div className="mt-3 space-y-1 text-sm text-foreground/75">
                  {shown.already && <p className="m-0">{t("alreadyAnswered")}</p>}
                  {shown.pct !== null && <p className="m-0">{t("percentCorrect", { pct: shown.pct })}</p>}
                  {!shown.recorded && <p className="m-0">{t("notRecorded")}</p>}
                  <p className="m-0">{t("comeBack")}</p>
                </div>
              </>
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
