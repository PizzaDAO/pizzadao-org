// app/ui/onboarding/MagicLoginFlow.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite of the "DM me a login link" form. Props, state machine,
// and API call (POST /api/auth/magic-login/request) are unchanged.
// arugula-30866 — i18n via next-intl (onboarding.magicLogin.*).
"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("onboarding.magicLogin");
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
        message: data.error || t("errorSomethingWrong"),
        username: name,
      });
    } catch {
      setState({
        step: "error",
        code: "network",
        message: t("errorNetwork"),
        username: name,
      });
    }
  }

  // ─── Login error from redirect ──────────────────────────────
  if (loginError) {
    const errorMessages: Record<string, string> = {
      invalid_token: t("errorInvalidToken"),
      link_expired: t("errorLinkExpired"),
      link_already_used: t("errorLinkAlreadyUsed"),
      missing_token: t("errorMissingToken"),
    };

    return (
      <Shell>
        <EditorialHeader
          overline={t("overline")}
          headline={t("tryAgainHeadline")}
        />
        <EditorialNotice
          tone="error"
          message={errorMessages[loginError] || t("errorGeneric")}
        />
        <BackLink onBack={onBack} label={t("back")} />
      </Shell>
    );
  }

  // ─── Sent state ─────────────────────────────────────────────
  if (state.step === "sent") {
    return (
      <Shell>
        <EditorialHeader
          overline={t("overline")}
          headline={t("checkDmsHeadline")}
        />
        <EditorialNotice
          tone="success"
          message={t.rich("sentMessage", {
            username: state.username,
            b: (chunks) => <strong className="text-foreground">{chunks}</strong>,
          })}
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
            {t("resendButton")}
          </button>
          <BackLink onBack={onBack} label={t("back")} />
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
            overline={t("overline")}
            headline={t("joinFirstHeadline")}
          />
          <EditorialNotice
            tone="info"
            message={t("joinFirstMessage")}
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
              {t("joinDiscordButton")}
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
              {t("joinedTryAgainButton")}
            </button>
            <BackLink onBack={onBack} label={t("back")} />
          </div>
        </Shell>
      );
    }

    if (state.code === "dm_failed") {
      return (
        <Shell>
          <EditorialHeader
            overline={t("overline")}
            headline={t("openDmsHeadline")}
          />
          <EditorialNotice
            tone="error"
            message={t("openDmsMessage")}
          />
          <ol
            className="ml-5 grid gap-2 text-[14px] leading-relaxed text-foreground/80"
            style={{ listStyleType: "decimal" }}
          >
            <li>{t("openDmsStep1")}</li>
            <li>{t("openDmsStep2")}</li>
            <li>{t("openDmsStep3")}</li>
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
              {t("tryAgainButton")}
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>
            <BackLink onBack={onBack} label={t("back")} />
          </div>
        </Shell>
      );
    }

    if (state.code === "rate_limited") {
      return (
        <Shell>
          <EditorialHeader
            overline={t("overline")}
            headline={t("slowDownHeadline")}
          />
          <EditorialNotice
            tone="error"
            message={t("rateLimitedMessage")}
          />
          <BackLink onBack={onBack} label={t("back")} />
        </Shell>
      );
    }

    // Generic error
    return (
      <Shell>
        <EditorialHeader
          overline={t("overline")}
          headline={t("snappedHeadline")}
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
            {t("tryAgainButton")}
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </button>
          <BackLink onBack={onBack} label={t("back")} />
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
        overline={t("overline")}
        headline={t("dmMeHeadline")}
      />
      <p
        className="max-w-md text-foreground/70"
        style={{ fontSize: "15px", lineHeight: 1.55 }}
      >
        {t("tagline")}
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
            placeholder={t("usernamePlaceholder")}
            autoFocus
            disabled={state.step === "sending"}
            aria-label={t("usernameAriaLabel")}
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
          {state.step === "sending" ? t("sendingButton") : t("sendButton")}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
        <BackLink onBack={onBack} label={t("back")} />
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

function BackLink({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="ui inline-flex items-center justify-center gap-1.5 self-center text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato min-h-11"
      style={{ background: "none", border: "none" }}
    >
      <ArrowLeft className="h-3 w-3" />
      {label}
    </button>
  );
}
