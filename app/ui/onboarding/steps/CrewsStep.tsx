// app/ui/onboarding/steps/CrewsStep.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite of the multi-select crews step. Props (including the
// success/successData shape used by the wizard for the inline summary),
// state and callbacks are unchanged.
// arugula-30866 — i18n via next-intl (onboarding.crews.*).
"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Check, Clock, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { TURTLES } from "../../constants";
import type { CrewOption } from "../types";
import { normKey, splitTurtlesCell } from "../types";

type Props = {
  crews: string[];
  turtles: string[];
  crewOptions: CrewOption[];
  crewsLoading: boolean;
  onChange: (crews: string[]) => void;
  onSubmit: () => void;
  onBack: () => void;
  isUpdate?: boolean;
  submitting?: boolean;
  success?: boolean;
  successData?: {
    mafiaName?: string;
    city: string;
    turtles: string[];
    crews: string[];
    resolvedMovieTitle?: string;
    mafiaMovieTitle: string;
    discordId?: string;
    discordJoined?: boolean;
  };
};

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.22), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

const CARD_TILTS = [-1.1, 0.8, -0.6, 1.0, -0.8, 0.6, -1.2, 0.9, -0.5, 1.1, -0.9, 0.7];

export function CrewsStep({
  crews,
  turtles,
  crewOptions,
  crewsLoading,
  onChange,
  onSubmit,
  onBack,
  isUpdate,
  submitting,
  success,
  successData,
}: Props) {
  const t = useTranslations("onboarding.crews");

  const turtleIdToLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const turtle of TURTLES as unknown as any[]) {
      if (!turtle) continue;
      const id = String(turtle.id ?? "").trim();
      const label = String(turtle.label ?? "").trim();
      if (id) m[id] = label || id;
    }
    return m;
  }, []);

  const recommendedCrewReasons = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!turtles.length) return map;

    for (const c of crewOptions) {
      const crewIdStr = String(c.id);
      const crewTurtlesNormalized = new Set(
        splitTurtlesCell((c as any)?.turtles).map(normKey)
      );

      const matches: string[] = [];
      for (const tId of turtles) {
        const tIdKey = normKey(tId);
        const tLabelKey = normKey(turtleIdToLabel[tId]);
        if (crewTurtlesNormalized.has(tIdKey) || crewTurtlesNormalized.has(tLabelKey)) {
          matches.push(tId);
        }
      }

      if (matches.length > 0) map.set(crewIdStr, matches);
    }
    return map;
  }, [turtles, crewOptions, turtleIdToLabel]);

  function toggleCrew(id: string) {
    const has = crews.includes(id);
    onChange(has ? crews.filter((x) => x !== id) : [...crews, id]);
  }

  const submitLabel = submitting
    ? isUpdate
      ? t("submitUpdating")
      : t("submitClaiming")
    : isUpdate
      ? t("submitUpdate")
      : t("submitClaim");

  return (
    <div className="relative grid gap-10 fade-up">
      {/* ─── Hero spotlight backdrop ─────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40svh] opacity-60"
        style={HERO_SPOTLIGHT}
      />

      {/* ─── Headline ────────────────────────────────────────────── */}
      <header className="relative">
        <p className="overline text-tomato">{t("overline")}</p>
        <h2
          className="font-[family-name:var(--font-display)] mt-3 max-w-[18ch] font-black tracking-[-0.015em] text-foreground"
          style={{
            fontSize: "clamp(2rem, 5.2vw, 3.6rem)",
            lineHeight: 0.95,
            textWrap: "balance",
          }}
        >
          {t("headingPrefix")} <span className="text-tomato">{t("headingAccent")}</span>{t("headingSuffix")}
        </h2>
        <p
          className="mt-4 max-w-xl text-foreground/70"
          style={{ fontSize: "16px", lineHeight: 1.55 }}
        >
          {t("tagline")}
        </p>

        {crewsLoading && (
          <p className="ui mt-4 text-[11px] uppercase tracking-[0.24em] text-foreground/50">
            {t("loading")}
          </p>
        )}
      </header>

      {/* ─── Crew cards ──────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
        {crewOptions.map((c, i) => {
          const idStr = String(c.id);
          const checked = crews.includes(idStr);
          const recommended = recommendedCrewReasons.get(idStr);
          const tilt = CARD_TILTS[i % CARD_TILTS.length]!;

          return (
            <CrewCard
              key={idStr}
              crew={c}
              checked={checked}
              recommended={recommended}
              tilt={tilt}
              onToggle={() => toggleCrew(idStr)}
            />
          );
        })}
      </section>

      {/* ─── Actions ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="ui inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("back")}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="btn-pill-lg group"
          style={{
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {submitLabel}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
      </div>

      {/* ─── Inline success summary (kept for back-compat) ──────── */}
      {success && successData && (
        <SuccessSummary
          successData={successData}
          crewOptions={crewOptions}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   CrewCard — paper-soft tile per crew
   ────────────────────────────────────────────────────────────────────────── */

function CrewCard({
  crew,
  checked,
  recommended,
  tilt,
  onToggle,
}: {
  crew: CrewOption;
  checked: boolean;
  recommended: string[] | undefined;
  tilt: number;
  onToggle: () => void;
}) {
  const t = useTranslations("onboarding.crews");

  return (
    <label
      style={{
        transform: `rotate(${checked ? 0 : tilt}deg)`,
        background: "hsl(var(--cream))",
        borderColor: checked
          ? "hsl(var(--tomato) / 0.7)"
          : "hsl(var(--rule-warm) / 0.55)",
        boxShadow: checked
          ? "0 36px 70px -28px hsl(0 93% 60% / 0.45)"
          : "var(--shadow-soft)",
      }}
      className={`group relative grid cursor-pointer gap-3 rounded-[20px] border p-4 transition-all duration-500 md:p-5 ${
        checked ? "-translate-y-1 z-10" : "hover:-translate-y-1 hover:rotate-0"
      }`}
    >
      <span
        aria-hidden
        className="grain pointer-events-none absolute inset-0 rounded-[20px] opacity-40"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px]"
        style={{
          backgroundImage:
            "radial-gradient(120% 80% at 0% 0%, hsl(40 35% 92% / 0.6), transparent 55%), radial-gradient(120% 80% at 100% 100%, hsl(28 30% 80% / 0.25), transparent 55%)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[20px] transition-opacity duration-500"
        style={{
          opacity: checked ? 1 : 0,
          background:
            "radial-gradient(70% 55% at 50% 0%, hsl(46 100% 62% / 0.14), transparent 70%)",
        }}
      />

      {/* Hidden but accessible checkbox */}
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="sr-only"
        aria-label={t("toggleAria", { crew: crew.label })}
      />

      <div className="relative flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            {crew.emoji && (
              <span
                aria-hidden
                className="text-[22px] leading-none"
                style={{ transform: "translateY(2px)", display: "inline-block" }}
              >
                {crew.emoji}
              </span>
            )}
            <h3
              className="font-[family-name:var(--font-display)] font-black tracking-[-0.005em] text-foreground"
              style={{ fontSize: "clamp(1.05rem, 1.5vw, 1.3rem)", lineHeight: 1.1 }}
            >
              {crew.label}
            </h3>
          </div>

          {recommended && recommended.length > 0 && (
            <div
              className="ui mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em]"
              style={{
                background: "hsl(var(--tomato) / 0.1)",
                border: "1px solid hsl(var(--tomato) / 0.3)",
                color: "hsl(var(--tomato))",
                fontWeight: 700,
              }}
            >
              <div className="flex items-center">
                {recommended.map((tId, idx) => {
                  const img = TURTLES.find((tu) => tu.id === tId)?.image;
                  if (!img) return null;
                  return (
                    <img
                      key={tId}
                      src={img}
                      alt={tId}
                      style={{
                        width: 16,
                        height: 16,
                        marginLeft: idx === 0 ? 0 : -4,
                        objectFit: "contain",
                        flexShrink: 0,
                      }}
                    />
                  );
                })}
              </div>
              {t("recommended")}
            </div>
          )}
        </div>

        {/* Selection chip */}
        <div
          className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full transition-all"
          style={{
            background: checked ? "hsl(var(--tomato))" : "transparent",
            border: checked
              ? "1px solid hsl(var(--tomato))"
              : "1.5px solid hsl(var(--foreground) / 0.25)",
            color: checked ? "hsl(var(--cream))" : "transparent",
          }}
          aria-hidden
        >
          <Check className="h-3.5 w-3.5" />
        </div>
      </div>

      {(crew.callTime || crew.callLength) && (
        <div className="relative ui flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-foreground/55">
          <Clock className="h-3 w-3" />
          {crew.callTime ? crew.callTime : ""}
          {crew.callTime && crew.callLength ? " · " : ""}
          {crew.callLength ? crew.callLength : ""}
        </div>
      )}

      {crew.tasks && crew.tasks.length > 0 && (
        <div className="relative grid gap-1">
          <div className="ui text-[9px] font-bold uppercase tracking-[0.28em] text-foreground/45">
            {t("topTasks")}
          </div>
          {crew.tasks.map((task, idx) => (
            <div
              key={idx}
              className="flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-foreground/80"
            >
              <span
                aria-hidden
                className="shrink-0"
                style={{ color: "hsl(var(--tomato))" }}
              >
                ·
              </span>
              <div className="overflow-hidden text-ellipsis whitespace-nowrap">
                {task.url ? (
                  <a
                    href={task.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-inherit underline underline-offset-2 hover:text-tomato"
                  >
                    {task.label}
                  </a>
                ) : (
                  <span>{task.label}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {crew.sheet && (
        <a
          href={crew.sheet}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ui relative inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.24em] text-foreground/55 no-underline hover:text-tomato"
          title={crew.sheet}
        >
          <ExternalLink className="h-3 w-3" />
          {t("openCrewSheet")}
        </a>
      )}
    </label>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Inline success summary (legacy path; ReviewStep is the primary surface)
   ────────────────────────────────────────────────────────────────────────── */

function SuccessSummary({
  successData,
  crewOptions,
}: {
  successData: NonNullable<Props["successData"]>;
  crewOptions: CrewOption[];
}) {
  const t = useTranslations("onboarding.crews");
  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[24px] border p-5 md:p-6"
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <p className="relative overline text-tomato">{t("successOverline")}</p>
      <h3
        className="font-[family-name:var(--font-display)] relative mt-2 font-black tracking-[-0.01em] text-foreground"
        style={{ fontSize: "clamp(1.4rem, 3vw, 2rem)", lineHeight: 1 }}
      >
        {t("successHeadingPrefix")}{" "}
        <span className="text-tomato">{successData.mafiaName}</span>.
      </h3>

      <div className="relative mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <SummaryLine label={t("summaryCity")} value={successData.city} />
        <SummaryLine
          label={t("summaryTurtles")}
          value={
            successData.turtles.length
              ? successData.turtles.join(", ")
              : t("summaryNone")
          }
        />
        <SummaryLine
          label={t("summaryCrews")}
          value={
            successData.crews.length
              ? successData.crews
                  .map((id) => {
                    const label = crewOptions.find((c) => c.id === id)?.label || id;
                    return label
                      .split(" ")
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                      .join(" ");
                  })
                  .join(", ")
              : t("summaryNone")
          }
        />
        <SummaryLine
          label={t("summaryMovie")}
          value={successData.resolvedMovieTitle ?? successData.mafiaMovieTitle}
        />
        {successData.discordId && (
          <SummaryLine
            label={t("summaryDiscord")}
            value={`${successData.discordJoined ? t("summaryJoined") : t("summaryLinked")} · ${successData.discordId}`}
          />
        )}
      </div>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="ui text-[10px] uppercase tracking-[0.28em] text-foreground/50">
        {label}
      </p>
      <p className="font-[family-name:var(--font-display)] mt-1 text-[15px] font-black leading-tight tracking-tight text-foreground">
        {value}
      </p>
    </div>
  );
}
