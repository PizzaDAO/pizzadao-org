// app/ui/onboarding/LoadingScreen.tsx
//
// mozzarella-41832 — Editorial restyle.
// Cinematic / cycling loader treatment. Props (message?, flow?) unchanged.
"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { FlowState } from "./types";

type Props = {
  message?: string;
  flow?: FlowState;
};

function getMessageFromFlow(flow: FlowState): string {
  switch (flow.type) {
    case "initializing":
      return "Loading…";
    case "checking_session":
      return "Checking session…";
    case "looking_up_member":
      return "Verifying member status…";
    case "submitting":
      return "Saving your profile…";
    case "success":
      return "Redirecting…";
    default:
      return "Loading…";
  }
}

function getOverlineFromFlow(flow?: FlowState): string {
  if (!flow) return "§ ··· One moment";
  switch (flow.type) {
    case "initializing":
      return "§ ··· Pulling up your file";
    case "checking_session":
      return "§ ··· Checking the door";
    case "looking_up_member":
      return "§ ··· Verifying the family record";
    case "submitting":
      return "§ ··· Filing the paperwork";
    case "success":
      return "§ ··· Welcome in";
    default:
      return "§ ··· One moment";
  }
}

const SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(60% 60% at 50% 30%, hsl(46 100% 62% / 0.20), transparent 65%), radial-gradient(70% 60% at 50% 100%, hsl(0 93% 60% / 0.10), transparent 70%)",
};

const SCRIBBLES = [
  "almost",
  "easy now",
  "give it a sec",
  "warming up the oven",
  "checking the books",
];

export function LoadingScreen({ message, flow }: Props) {
  const displayMessage = message ?? (flow ? getMessageFromFlow(flow) : "Loading…");
  const overline = getOverlineFromFlow(flow);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1400);
    return () => window.clearInterval(id);
  }, []);

  const scribble = SCRIBBLES[tick % SCRIBBLES.length];

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
          {SCRIBBLES[(tick + 2) % SCRIBBLES.length]}
        </span>
      </div>
    </div>
  );
}
