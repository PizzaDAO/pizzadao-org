// app/ui/onboarding/steps/RolesStep.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite of the turtle / roles picker. The Props interface,
// callbacks, and the underlying TURTLES data shape are unchanged.
// arugula-30866 — i18n via next-intl (onboarding.roles.*).
"use client";

import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { TURTLES } from "../../constants";

type Props = {
  turtles: string[];
  onChange: (turtles: string[]) => void;
  onNext: () => void;
  onBack: () => void;
  isUpdate?: boolean;
};

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.22), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

// Small visual personality per card — rotation only, no semantic effect.
const CARD_TILTS = [-1.4, 0.9, -0.6, 1.1, -1.1, 0.7, -0.8, 1.2];

// Turtle ids that have dedicated translated notes; all others fall through
// to `notes.offCanon`.
const KNOWN_TURTLE_KEYS = new Set([
  "Leonardo",
  "Donatello",
  "Michelangelo",
  "Raphael",
]);

export function RolesStep({ turtles, onChange, onNext, onBack, isUpdate: _isUpdate }: Props) {
  const t = useTranslations("onboarding.roles");
  const canProceed = turtles.length > 0;

  function toggleTurtle(id: string) {
    const has = turtles.includes(id);
    onChange(has ? turtles.filter((x) => x !== id) : [...turtles, id]);
  }

  function noteFor(id: string): string {
    return KNOWN_TURTLE_KEYS.has(id) ? t(`notes.${id}`) : t("notes.offCanon");
  }

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
      </header>

      {/* ─── Turtle cards ────────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
        {TURTLES.map((turtle, i) => {
          const selected = turtles.includes(turtle.id);
          const tilt = CARD_TILTS[i % CARD_TILTS.length]!;
          const note = noteFor(turtle.id);

          return (
            <TurtleCard
              key={turtle.id}
              id={turtle.id}
              label={turtle.label}
              role={turtle.role}
              image={turtle.image}
              note={note}
              tilt={tilt}
              selected={selected}
              onToggle={() => toggleTurtle(turtle.id)}
            />
          );
        })}
      </section>

      {/* ─── Selected summary ────────────────────────────────────── */}
      <p className="ui text-[11px] uppercase tracking-[0.24em] text-foreground/55">
        {t("selectedLabel")}{" "}
        <b className="text-foreground">
          {turtles.length ? turtles.join(", ") : t("noneYet")}
        </b>
      </p>

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
          onClick={onNext}
          disabled={!canProceed}
          className="btn-pill-lg group"
          style={{
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {t("next")}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   CinematicSelectCard — paper-soft turtle tile
   ────────────────────────────────────────────────────────────────────────── */

function TurtleCard({
  id: _id,
  label,
  role,
  image,
  note,
  tilt,
  selected,
  onToggle,
}: {
  id: string;
  label: string;
  role: string;
  image: string;
  note: string;
  tilt: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      style={{
        transform: `rotate(${selected ? 0 : tilt}deg)`,
        background: "hsl(var(--cream))",
        borderColor: selected
          ? "hsl(var(--tomato) / 0.7)"
          : "hsl(var(--rule-warm) / 0.55)",
        boxShadow: selected
          ? "0 36px 70px -28px hsl(0 93% 60% / 0.45)"
          : "var(--shadow-soft)",
      }}
      className={`group relative flex items-center gap-4 rounded-[20px] border p-4 text-left transition-all duration-500 md:p-5 ${
        selected ? "-translate-y-1 z-10" : "hover:-translate-y-1 hover:rotate-0"
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
          opacity: selected ? 1 : 0,
          background:
            "radial-gradient(70% 55% at 50% 0%, hsl(46 100% 62% / 0.14), transparent 70%)",
        }}
      />

      <div
        className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full"
        style={{
          background: "hsl(var(--cream) / 0.65)",
          border: "1.5px dashed hsl(var(--foreground) / 0.3)",
          transform: "rotate(-4deg)",
        }}
      >
        <img
          src={image}
          alt={label}
          className="h-9 w-9 object-contain"
        />
      </div>

      <div className="relative flex-1 min-w-0">
        <h3
          className="font-[family-name:var(--font-display)] font-black tracking-[-0.005em] text-foreground"
          style={{ fontSize: "clamp(1.1rem, 1.6vw, 1.4rem)", lineHeight: 1.05 }}
        >
          {label}
        </h3>
        <p className="ui mt-1 text-[10px] uppercase tracking-[0.24em] text-foreground/55">
          {role}
        </p>
      </div>

      <div
        className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full transition-all"
        style={{
          background: selected ? "hsl(var(--tomato))" : "transparent",
          border: selected
            ? "1px solid hsl(var(--tomato))"
            : "1.5px solid hsl(var(--foreground) / 0.25)",
          color: selected ? "hsl(var(--cream))" : "transparent",
        }}
        aria-hidden
      >
        <Check className="h-3.5 w-3.5" />
      </div>

      <span
        aria-hidden
        className="handwritten pointer-events-none absolute -bottom-3 right-5 rotate-[-6deg] transition-all duration-500"
        style={{
          fontSize: "15px",
          color: selected ? "hsl(var(--tomato))" : "hsl(var(--foreground) / 0.45)",
          opacity: selected ? 1 : 0.75,
        }}
      >
        {note}
      </span>
    </button>
  );
}
