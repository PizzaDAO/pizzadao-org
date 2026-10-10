// app/ui/onboarding/steps/WelcomeStep.tsx
//
// mozzarella-41832 — Editorial restyle.
// Welcome screen with a single Discord DM login entry point.
"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { CommunityPreview } from "../CommunityPreview";
import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

type Props = {
  onJoin: () => void;
  onLogin: () => void;
};

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(85% 60% at 25% 0%, hsl(46 100% 62% / 0.28), transparent 60%), radial-gradient(70% 55% at 100% 12%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

const DOCK_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(60% 80% at 20% 0%, hsl(46 100% 62% / 0.18), transparent 70%), radial-gradient(60% 80% at 100% 100%, hsl(0 93% 60% / 0.18), transparent 70%)",
};

export function WelcomeStep({ onJoin, onLogin }: Props) {
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
          <Image
            src="/brand-kit/molto-benny/molto-benny-color.svg"
            alt="PizzaDAO"
            width={100}
            height={64}
            className="h-16 w-auto max-w-full object-contain"
            style={{ transform: "rotate(-2deg)" }}
          />
        </div>

        <p className="overline text-tomato-readable">{t("overline")}</p>

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
          className="handwritten pointer-events-none absolute right-[2%] bottom-[-28px] hidden max-w-[180px] text-right rotate-[5deg] text-[16px] text-tomato-readable md:block"
          style={{ opacity: 0.85 }}
        >
          {t("doorNote")}
        </span>
        <span
          aria-hidden
          className="handwritten pointer-events-none absolute left-[4%] bottom-[-12px] hidden rotate-[-5deg] text-[16px] text-foreground/70 md:block"
        >
          {t("appetiteNote")}
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
              {t("stepIn")}
            </p>

            <button
              onClick={onJoin}
              className="btn-pill-lg group"
              style={{
                background: "hsl(var(--tomato-deep))",
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


        <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-1">
          <Link href="/crews" className="inline-flex min-h-11 items-center font-semibold text-tomato-readable underline underline-offset-4">{t("explore")}</Link>
          <Link href="/articles" className="inline-flex min-h-11 items-center text-foreground/80 underline underline-offset-4">{t("stories")}</Link>
          <Link href="/manuals" className="inline-flex min-h-11 items-center text-foreground/80 underline underline-offset-4">{t("guides")}</Link>
        </div>
      </section>
      <CommunityPreview />
    </div>
  );
}
