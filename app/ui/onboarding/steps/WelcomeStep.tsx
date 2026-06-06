// app/ui/onboarding/steps/WelcomeStep.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite of the welcome screen. Props (`onJoin`, `onLogin`,
// `onMagicLogin`) and i18n keys are unchanged — wizard flow is untouched.
"use client";

import type { CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

type Props = {
  onJoin: () => void;
  onLogin: () => void;
  onMagicLogin: () => void;
};

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(85% 60% at 25% 0%, hsl(46 100% 62% / 0.28), transparent 60%), radial-gradient(70% 55% at 100% 12%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

const DOCK_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(60% 80% at 20% 0%, hsl(46 100% 62% / 0.18), transparent 70%), radial-gradient(60% 80% at 100% 100%, hsl(0 93% 60% / 0.18), transparent 70%)",
};

export function WelcomeStep({ onJoin, onLogin, onMagicLogin }: Props) {
  const t = useTranslations("onboarding.welcome");

  return (
    <div className="relative grid gap-12 fade-up py-2 sm:py-4">
      {/* ─── Hero spotlight backdrop ─────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60svh] opacity-60"
        style={HERO_SPOTLIGHT}
      />

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <header className="relative text-center">
        <div className="flex justify-center mb-6">
          <img
            src="/brand-kit/molto-benny/molto-benny-color.svg"
            alt="PizzaDAO"
            className="h-16 w-auto max-w-full object-contain"
            style={{ transform: "rotate(-2deg)" }}
          />
        </div>

        <p className="overline text-tomato">§ ··· The Invitation</p>

        <h1
          className="font-[family-name:var(--font-display)] mx-auto mt-4 max-w-[16ch] font-black tracking-[-0.015em] text-foreground"
          style={{
            fontSize: "clamp(2.5rem, 7vw, 5.5rem)",
            lineHeight: 0.9,
            textWrap: "balance",
          }}
        >
          {t("heading")}
        </h1>

        <p
          className="mx-auto mt-6 max-w-xl text-foreground/75"
          style={{ fontSize: "17px", lineHeight: 1.55, textWrap: "pretty" }}
        >
          {t("tagline")}
        </p>

        {/* Handwritten margin annotation — tucked beside the headline,
            well below the centered 64-px logo so the wordmark stays clear. */}
        <span
          aria-hidden
          className="handwritten pointer-events-none absolute right-[2%] top-[42%] hidden rotate-[8deg] text-[18px] text-tomato md:block lg:right-[-2%]"
          style={{ opacity: 0.85 }}
        >
          come in, the door's open
        </span>
        <span
          aria-hidden
          className="handwritten pointer-events-none absolute left-[4%] bottom-[-12px] hidden rotate-[-5deg] text-[16px] text-foreground/55 md:block"
        >
          bring your appetite
        </span>
      </header>

      {/* ─── Ink-bottom CTA dock ─────────────────────────────────── */}
      <section className="relative">
        <div
          className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-[28px] border px-6 py-7 md:px-9 md:py-8"
          style={{
            background: "hsl(var(--ink) / 0.96)",
            color: "hsl(var(--cream))",
            borderColor: "hsl(var(--cream) / 0.15)",
            boxShadow:
              "0 30px 60px -30px hsl(0 93% 60% / 0.45), var(--shadow-lifted)",
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-80"
            style={DOCK_SPOTLIGHT}
          />
          <div
            aria-hidden
            className="grain pointer-events-none absolute inset-0 opacity-50"
          />

          <div className="relative grid gap-4">
            <p
              className="overline"
              style={{ color: "hsl(var(--butter))" }}
            >
              § Step in
            </p>

            <button
              onClick={onJoin}
              className="btn-pill-lg group"
              style={{
                background: "hsl(var(--tomato))",
                color: "hsl(var(--cream))",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              {t("joinButton")}
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>

            <button
              onClick={onLogin}
              className="btn-pill-lg group"
              style={{
                background: "transparent",
                color: "hsl(var(--cream))",
                border: "1px solid hsl(var(--cream) / 0.28)",
              }}
            >
              {t("loginButton")}
            </button>
          </div>
        </div>

        {/* Tertiary magic-login link */}
        <div className="mt-5 text-center">
          <button
            onClick={onMagicLogin}
            /* sicilian-41551: 44-px tap target on the tertiary link. */
            className="ui inline-flex items-center justify-center min-h-11 px-3 text-[11px] uppercase tracking-[0.24em] text-foreground/55 transition-colors hover:text-tomato cursor-pointer"
            style={{ background: "none", border: "none" }}
          >
            {t("magicLoginButton")}
          </button>
        </div>
      </section>
    </div>
  );
}
