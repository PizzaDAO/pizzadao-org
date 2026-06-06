// app/ui/onboarding/ClaimFlow.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite of the existing-account claim flow. Props, internal step
// state, and API calls (/api/user-data/[id], /api/claim-member) are
// unchanged. The flow still routes to /dashboard/{memberId} on success.
// arugula-30866 — i18n via next-intl (onboarding.claim.*).
"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Hash, Lock } from "lucide-react";
import { useTranslations } from "next-intl";

type ClaimStep = "ask" | "input-id" | "input-pass" | "processing";

type Props = {
  discordId: string;
  discordNick?: string;
  onStartRegistration: () => void;
};

const PAGE_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 25% 0%, hsl(46 100% 62% / 0.22), transparent 60%), radial-gradient(70% 60% at 100% 12%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

export function ClaimFlow({
  discordId,
  discordNick: _discordNick,
  onStartRegistration,
}: Props) {
  const t = useTranslations("onboarding.claim");
  const router = useRouter();
  const [step, setStep] = useState<ClaimStep>("ask");
  const [memberId, setMemberId] = useState("");
  const [foundName, setFoundName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkMemberId() {
    if (!memberId.trim()) {
      setError(t("errorEnterId"));
      return;
    }
    setStep("processing");
    setError(null);
    try {
      const res = await fetch(`/api/user-data/${memberId}`);
      if (res.ok) {
        const data = await res.json();
        const name = data["Name"] || data["Mafia Name"] || t("nameUnknown");
        setFoundName(name);
        setStep("input-pass");
      } else {
        setError(t("errorIdNotFound"));
        setStep("input-id");
      }
    } catch {
      setError(t("errorCheckId"));
      setStep("input-id");
    }
  }

  async function submitClaim(password: string) {
    setStep("processing");
    setError(null);
    try {
      const res = await fetch("/api/claim-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, discordId, password }),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(`/dashboard/${memberId}`);
      } else {
        setError(json.error || t("errorClaimFailed"));
        setStep("input-pass");
      }
    } catch {
      setError(t("errorNetwork"));
      setStep("input-pass");
    }
  }

  return (
    <div className="relative min-h-screen bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60svh] opacity-60"
        style={PAGE_SPOTLIGHT}
      />

      <div className="flex min-h-screen items-center justify-center p-5">
        <div
          className="paper-soft relative w-full max-w-lg overflow-hidden rounded-[28px] border p-6 md:p-9"
          style={{
            background: "hsl(var(--card))",
            borderColor: "hsl(var(--rule-warm) / 0.55)",
            boxShadow: "var(--shadow-lifted)",
          }}
        >
          {step === "ask" && (
            <div className="relative grid gap-6 fade-up">
              <header>
                <p className="overline text-tomato">{t("askOverline")}</p>
                <h2
                  className="font-[family-name:var(--font-display)] mt-3 max-w-[14ch] font-black tracking-[-0.015em] text-foreground"
                  style={{
                    fontSize: "clamp(1.8rem, 5vw, 2.8rem)",
                    lineHeight: 0.95,
                    textWrap: "balance",
                  }}
                >
                  {t("askHeadlinePrefix")}{" "}
                  <span className="text-tomato">{t("askHeadlineAccent")}</span>
                  {t("askHeadlineSuffix")}
                </h2>
              </header>

              <p
                className="text-foreground/75"
                style={{ fontSize: "15px", lineHeight: 1.55 }}
              >
                {t("askIntro")}
              </p>
              <p className="font-[family-name:var(--font-display)] font-black text-foreground">
                {t("askPrompt")}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setStep("input-id")}
                  className="btn-pill-lg group"
                  style={{
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  {t("askYes")}
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={onStartRegistration}
                  className="btn-pill-lg"
                  style={{
                    background: "transparent",
                    color: "hsl(var(--foreground))",
                    border: "1px solid hsl(var(--foreground) / 0.25)",
                  }}
                >
                  {t("askNo")}
                </button>
              </div>
            </div>
          )}

          {step === "input-id" && (
            <div className="relative grid gap-5 fade-up">
              <header>
                <p className="overline text-tomato">{t("inputIdOverline")}</p>
                <h2
                  className="font-[family-name:var(--font-display)] mt-3 font-black tracking-[-0.015em] text-foreground"
                  style={{
                    fontSize: "clamp(1.5rem, 4vw, 2rem)",
                    lineHeight: 0.95,
                  }}
                >
                  {t("inputIdHeadline")}
                </h2>
                <p className="mt-3 text-sm text-foreground/65">
                  {t("inputIdHint")}
                </p>
              </header>

              <CinematicField
                icon={<Hash className="h-5 w-5 shrink-0 text-foreground/35" />}
              >
                <input
                  type="text"
                  placeholder={t("inputIdPlaceholder")}
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  aria-label={t("inputIdAriaLabel")}
                  className="font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none"
                  style={{
                    fontSize: "clamp(1.2rem, 2.4vw, 1.7rem)",
                    color: "hsl(var(--foreground))",
                  }}
                />
              </CinematicField>

              {error && <InlineError message={error} />}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep("ask");
                    setError(null);
                  }}
                  className="ui inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato min-h-11"
                >
                  <ArrowLeft className="h-3 w-3" />
                  {t("back")}
                </button>
                <button
                  type="button"
                  onClick={checkMemberId}
                  className="btn-pill-lg group"
                  style={{
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  {t("inputIdSearch")}
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          )}

          {step === "input-pass" && (
            <form
              className="relative grid gap-5 fade-up"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                submitClaim(String(fd.get("password")));
              }}
            >
              <header>
                <p className="overline text-tomato">{t("inputPassOverline")}</p>
                <h2
                  className="font-[family-name:var(--font-display)] mt-3 font-black tracking-[-0.015em] text-foreground"
                  style={{
                    fontSize: "clamp(1.5rem, 4vw, 2rem)",
                    lineHeight: 0.95,
                  }}
                >
                  {t("inputPassHeadingPrefix")}{" "}
                  <span className="text-tomato">{foundName}</span>
                </h2>
                <p className="mt-3 text-sm text-foreground/65">
                  {t("inputPassHint")}
                </p>
              </header>

              <CinematicField
                icon={<Lock className="h-5 w-5 shrink-0 text-foreground/35" />}
              >
                <input
                  name="password"
                  type="password"
                  placeholder={t("inputPassPlaceholder")}
                  autoFocus
                  aria-label={t("inputPassAriaLabel")}
                  className="font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none"
                  style={{
                    fontSize: "clamp(1.2rem, 2.4vw, 1.7rem)",
                    color: "hsl(var(--foreground))",
                  }}
                />
              </CinematicField>

              {error && <InlineError message={error} />}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep("input-id");
                    setError(null);
                  }}
                  className="ui inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato min-h-11"
                >
                  <ArrowLeft className="h-3 w-3" />
                  {t("back")}
                </button>
                <button
                  type="submit"
                  className="btn-pill-lg group"
                  style={{
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  {t("inputPassSubmit")}
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </button>
              </div>
            </form>
          )}

          {step === "processing" && (
            <div className="relative grid place-items-center gap-3 py-10 fade-up">
              <p className="overline text-tomato/70">{t("processingOverline")}</p>
              <div className="flex gap-1.5">
                <span
                  className="h-2 w-2 animate-pulse rounded-full"
                  style={{ background: "hsl(var(--tomato))" }}
                />
                <span
                  className="h-2 w-2 animate-pulse rounded-full"
                  style={{
                    background: "hsl(var(--tomato))",
                    animationDelay: "120ms",
                  }}
                />
                <span
                  className="h-2 w-2 animate-pulse rounded-full"
                  style={{
                    background: "hsl(var(--tomato))",
                    animationDelay: "240ms",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────────── */

function CinematicField({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[20px]"
      style={{
        background: "hsl(var(--cream))",
        border: "1px solid hsl(var(--rule-warm) / 0.6)",
        boxShadow: "0 20px 40px -32px hsl(46 100% 50% / 0.3)",
      }}
    >
      <div
        aria-hidden
        className="grain pointer-events-none absolute inset-0 opacity-40"
      />
      <div className="relative flex items-center gap-3 px-4 py-3.5 md:gap-4 md:px-5 md:py-4">
        {icon}
        {children}
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[14px] border px-4 py-3"
      style={{
        background: "hsl(var(--destructive) / 0.08)",
        borderColor: "hsl(var(--destructive) / 0.3)",
      }}
    >
      <p
        className="relative ui text-[12px] uppercase tracking-[0.22em] font-bold"
        style={{ color: "hsl(var(--destructive))" }}
      >
        {message}
      </p>
    </div>
  );
}
