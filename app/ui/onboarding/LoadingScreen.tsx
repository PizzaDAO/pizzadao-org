// app/ui/onboarding/LoadingScreen.tsx
//
// mozzarella-41832 — Editorial restyle.
// Cinematic / cycling loader treatment. Props (message?, flow?) unchanged.
// arugula-30866 — i18n via next-intl (onboarding.loading.*).
"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { FlowState } from "./types";

type Props = {
  message?: string;
  flow?: FlowState;
};

const SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(60% 60% at 50% 30%, hsl(46 100% 62% / 0.20), transparent 65%), radial-gradient(70% 60% at 50% 100%, hsl(0 93% 60% / 0.10), transparent 70%)",
};

// Stable ordered list of scribble keys so adjacent slots show different text.
const SCRIBBLE_KEYS = [
  "almost",
  "easyNow",
  "giveItASec",
  "warmingOven",
  "checkingBooks",
] as const;

export function LoadingScreen({ message, flow }: Props) {
  const t = useTranslations("onboarding.loading");

  function getMessageFromFlow(f: FlowState): string {
    switch (f.type) {
      case "initializing":
        return t("defaultMessage");
      case "checking_session":
        return t("checkingSession");
      case "looking_up_member":
        return t("lookingUpMember");
      case "submitting":
        return t("submitting");
      case "success":
        return t("redirecting");
      default:
        return t("defaultMessage");
    }
  }

  function getOverlineFromFlow(f?: FlowState): string {
    if (!f) return t("defaultOverline");
    switch (f.type) {
      case "initializing":
        return t("initializingOverline");
      case "checking_session":
        return t("checkingSessionOverline");
      case "looking_up_member":
        return t("lookingUpMemberOverline");
      case "submitting":
        return t("submittingOverline");
      case "success":
        return t("successOverline");
      default:
        return t("defaultOverline");
    }
  }

  const displayMessage = message ?? (flow ? getMessageFromFlow(flow) : t("defaultMessage"));
  const overline = getOverlineFromFlow(flow);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1400);
    return () => window.clearInterval(id);
  }, []);

  const scribble = t(`scribbles.${SCRIBBLE_KEYS[tick % SCRIBBLE_KEYS.length]}`);
  const scribbleAlt = t(
    `scribbles.${SCRIBBLE_KEYS[(tick + 2) % SCRIBBLE_KEYS.length]}`,
  );

  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[28px] border fade-up"
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={SPOTLIGHT}
      />

      <div className="relative grid place-items-center gap-5 py-14 md:py-20">
        <p className="overline text-tomato/80">{overline}</p>

        {/* Spinning dot trio */}
        <div className="flex gap-2">
          <span
            className="h-2.5 w-2.5 animate-pulse rounded-full"
            style={{ background: "hsl(var(--tomato))" }}
          />
          <span
            className="h-2.5 w-2.5 animate-pulse rounded-full"
            style={{
              background: "hsl(var(--tomato))",
              animationDelay: "120ms",
            }}
          />
          <span
            className="h-2.5 w-2.5 animate-pulse rounded-full"
            style={{
              background: "hsl(var(--tomato))",
              animationDelay: "240ms",
            }}
          />
        </div>

        {/* Headline */}
        <p
          className="font-[family-name:var(--font-display)] mx-auto max-w-md text-center font-black tracking-[-0.005em] text-foreground/85"
          style={{ fontSize: "clamp(1.1rem, 2.5vw, 1.6rem)", lineHeight: 1.1 }}
        >
          {displayMessage}
        </p>

        {/* Hand-scrawled margin notes */}
        <span
          aria-hidden
          className="handwritten pointer-events-none absolute left-[8%] top-[18%] hidden rotate-[-8deg] text-[18px] text-foreground/40 md:block"
        >
          {scribble}
        </span>
        <span
          aria-hidden
          className="handwritten pointer-events-none absolute right-[10%] bottom-[18%] hidden rotate-[6deg] text-[16px] text-tomato/70 md:block"
        >
          {scribbleAlt}
        </span>
      </div>
    </div>
  );
}
