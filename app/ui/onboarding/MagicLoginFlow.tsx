// app/ui/onboarding/MagicLoginFlow.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite of the "DM me a login link" form. Props, state machine,
// and API call (POST /api/auth/magic-login/request) are unchanged.
"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";

const DISCORD_INVITE =
  process.env.NEXT_PUBLIC_DISCORD_INVITE || "https://discord.gg/pizzadao";

type State =
  | { step: "form" }
  | { step: "sending" }
  | { step: "sent"; username: string }
  | { step: "error"; code: string; message: string; username: string };

type Props = {
  onBack: () => void;
  loginError?: string | null;
};

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 30% 0%, hsl(46 100% 62% / 0.20), transparent 65%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.10), transparent 70%)",
};

export function MagicLoginFlow({ onBack, loginError }: Props) {
  const [username, setUsername] = useState("");
  const [state, setState] = useState<State>({ step: "form" });

  async function handleSubmit(retryUsername?: string) {
    const name = retryUsername || username.trim();
    if (name.length < 2) return;

    setState({ step: "sending" });

    try {
      const res = await fetch("/api/auth/magic-login/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      });

      const data = await res.json();

      if (res.ok) {
        setState({ step: "sent", username: name });
        return;
      }

      setState({
        step: "error",
        code: data.status || "unknown",
        message: data.error || "Something went wrong",
        username: name,
      });
    } catch {
      setState({
        step: "error",
        code: "network",
        message: "Network error. Please check your connection and try again.",
        username: name,
      });
    }
  }

  // ─── Login error from redirect ──────────────────────────────
  if (loginError) {
    const errorMessages: Record<string, string> = {
      invalid_token: "That login link is invalid.",
      link_expired: "That login link has expired. Request a new one.",
      link_already_used: "That login link has already been used. Request a new one.",
      missing_token: "No login token provided.",
    };

    return (
      <Shell>
        <EditorialHeader
          overline="§ ··· Login via Discord DM"
          headline="Try again."
        />
        <EditorialNotice
          tone="error"
          message={errorMessages[loginError] || "Login failed. Please try again."}
        />
        <BackLink onBack={onBack} />
      </Shell>
    );
  }

  // ─── Sent state ─────────────────────────────────────────────
  if (state.step === "sent") {
    return (
      <Shell>
        <EditorialHeader
          overline="§ ··· Login via Discord DM"
          headline="Check your DMs."
        />
        <EditorialNotice
          tone="success"
          message={
            <>
              We sent a login link to{" "}
              <strong className="text-foreground">{state.username}</strong> on
              Discord. The link expires in 10 minutes.
            </>
          }
        />
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => handleSubmit(state.username)}
            className="btn-pill-lg"
            style={{
              background: "transparent",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--foreground) / 0.25)",
            }}
          >
            Resend
          </button>
          <BackLink onBack={onBack} />
        </div>
      </Shell>
    );
  }

  // ─── Error states ───────────────────────────────────────────
  if (state.step === "error") {
    if (state.code === "not_found") {
      return (
        <Shell>
          <EditorialHeader
            overline="§ ··· Login via Discord DM"
            headline="Join first."
          />
          <EditorialNotice
            tone="info"
            message="You need to be in the PizzaDAO Discord to use this. Our bot can only DM members of the server."
          />
          <div className="grid gap-3">
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-pill-lg group no-underline"
              style={{
                background: "hsl(var(--tomato))",
                color: "hsl(var(--cream))",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              Join PizzaDAO Discord
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
            <button
              type="button"
              onClick={() => handleSubmit(state.username)}
              className="btn-pill-lg"
              style={{
                background: "transparent",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--foreground) / 0.25)",
              }}
            >
              I&apos;ve joined, try again
            </button>
            <BackLink onBack={onBack} />
          </div>
        </Shell>
      );
    }

    if (state.code === "dm_failed") {
      return (
        <Shell>
          <EditorialHeader
            overline="§ ··· Login via Discord DM"
            headline="Open your DMs."
          />
          <EditorialNotice
            tone="error"
            message="Couldn't send you a DM. To receive the login link, enable DMs from server members:"
          />
          <ol
            className="ml-5 grid gap-2 text-[14px] leading-relaxed text-foreground/80"
            style={{ listStyleType: "decimal" }}
          >
            <li>Open Discord and go to the PizzaDAO server</li>
            <li>Click the server name at the top</li>
            <li>Privacy Settings → Enable &quot;Direct Messages&quot;</li>
          </ol>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => handleSubmit(state.username)}
              className="btn-pill-lg group"
              style={{
                background: "hsl(var(--tomato))",
                color: "hsl(var(--cream))",
              }}
            >
              Try again
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>
            <BackLink onBack={onBack} />
          </div>
        </Shell>
      );
    }

    if (state.code === "rate_limited") {
      return (
        <Shell>
          <EditorialHeader
            overline="§ ··· Login via Discord DM"
            headline="Slow down."
          />
          <EditorialNotice
            tone="error"
            message="Too many requests. Please try again in a few minutes."
          />
          <BackLink onBack={onBack} />
        </Shell>
      );
    }

    // Generic error
    return (
      <Shell>
        <EditorialHeader
          overline="§ ··· Login via Discord DM"
          headline="Something snapped."
        />
        <EditorialNotice tone="error" message={state.message} />
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => handleSubmit(state.username)}
            className="btn-pill-lg group"
            style={{
              background: "hsl(var(--tomato))",
              color: "hsl(var(--cream))",
            }}
          >
            Try again
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </button>
          <BackLink onBack={onBack} />
        </div>
      </Shell>
    );
  }

  // ─── Form / sending state ──────────────────────────────────
  return (
    <Shell>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40svh] opacity-60"
        style={HERO_SPOTLIGHT}
      />
      <EditorialHeader
        overline="§ ··· Login via Discord DM"
        headline="DM me a link."
      />
      <p
        className="max-w-md text-foreground/70"
        style={{ fontSize: "15px", lineHeight: 1.55 }}
      >
        Enter your Discord username and we&apos;ll DM you a magic login link
        that&apos;s good for 10 minutes.
      </p>

      <div
        className="relative overflow-hidden rounded-[22px] transition-shadow"
        style={{
          background: "hsl(var(--cream))",
          border: "1px solid hsl(var(--rule-warm) / 0.6)",
          boxShadow: "0 30px 60px -40px hsl(46 100% 50% / 0.35)",
        }}
      >
        <div
          aria-hidden
          className="grain pointer-events-none absolute inset-0 opacity-40"
        />
        <label className="relative flex items-center gap-3 px-4 py-3.5 md:gap-4 md:px-5 md:py-4">
          <Sparkles
            className="h-5 w-5 shrink-0 text-foreground/35"
            aria-hidden
          />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Discord username"
            autoFocus
            disabled={state.step === "sending"}
            aria-label="Discord username"
            className="font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none disabled:opacity-50"
            style={{
              fontSize: "clamp(1.1rem, 2.2vw, 1.5rem)",
              color: "hsl(var(--foreground))",
            }}
          />
        </label>
      </div>

      <div className="grid gap-3">
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={state.step === "sending" || username.trim().length < 2}
          className="btn-pill-lg group"
          style={{
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {state.step === "sending" ? "Sending…" : "Send login link"}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
        <BackLink onBack={onBack} />
      </div>
    </Shell>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Sub-components
   ────────────────────────────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="relative grid gap-6 fade-up py-2">{children}</div>;
}

function EditorialHeader({
  overline,
  headline,
}: {
  overline: string;
  headline: string;
}) {
  return (
    <header className="relative">
      <p className="overline text-tomato">{overline}</p>
      <h2
        className="font-[family-name:var(--font-display)] mt-3 max-w-[16ch] font-black tracking-[-0.015em] text-foreground"
        style={{
          fontSize: "clamp(1.8rem, 4.4vw, 2.8rem)",
          lineHeight: 0.95,
          textWrap: "balance",
        }}
      >
        {headline}
      </h2>
    </header>
  );
}

function EditorialNotice({
  tone,
  message,
}: {
  tone: "success" | "info" | "error";
  message: React.ReactNode;
}) {
  const palette = {
    success: {
      bg: "hsl(140 50% 95%)",
      border: "hsl(140 50% 35% / 0.35)",
      ink: "hsl(140 50% 28%)",
    },
    info: {
      bg: "hsl(var(--muted))",
      border: "hsl(var(--foreground) / 0.18)",
      ink: "hsl(var(--foreground))",
    },
    error: {
      bg: "hsl(var(--destructive) / 0.1)",
      border: "hsl(var(--destructive) / 0.35)",
      ink: "hsl(var(--destructive))",
    },
  }[tone];

  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[18px] border p-4 md:p-5"
      style={{
        background: palette.bg,
        borderColor: palette.border,
      }}
    >
      <p
        className="relative font-[family-name:var(--font-display)] font-bold"
        style={{
          color: palette.ink,
          fontSize: "15px",
          lineHeight: 1.4,
        }}
      >
        {message}
      </p>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="ui inline-flex items-center justify-center gap-1.5 self-center text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato min-h-11"
      style={{ background: "none", border: "none" }}
    >
      <ArrowLeft className="h-3 w-3" />
      Back
    </button>
  );
}
