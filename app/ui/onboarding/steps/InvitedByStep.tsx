// app/ui/onboarding/steps/InvitedByStep.tsx
//
// L3.1 "Invite a friend" (plans/mission-verification.md D4): an optional
// "Who invited you?" step for new members. Search a member by name or member
// ID (GET /api/referrals/inviters), pick one, or say "no one". Pre-filled
// when the person arrived through a personal invite link (/join?ref=…).
// The choice is sent with the profile (POST /api/profile) and recorded as a
// Referral once onboarding completes. i18n: onboarding.invitedBy.*.
"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Search, UserCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { InvitedBy } from "../types";

type Props = {
  /** undefined = not answered yet, null = no one. */
  value: InvitedBy | null | undefined;
  /** The member ID this person picked (they can't invite themselves). */
  ownMemberId?: string;
  onChange: (v: InvitedBy | null | undefined) => void;
  onNext: () => void;
  onBack: () => void;
};

type Result = { memberId: string; name: string; city: string | null };

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.22), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

const CARD: CSSProperties = {
  background: "hsl(var(--card))",
  borderColor: "hsl(var(--rule-warm) / 0.55)",
  boxShadow: "var(--shadow-soft)",
};

export function InvitedByStep({ value, ownMemberId, onChange, onNext, onBack }: Props) {
  const t = useTranslations("onboarding.invitedBy");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 && !/^\d+$/.test(q)) {
      setResults([]);
      setSearched(false);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/referrals/inviters?q=${encodeURIComponent(q)}`);
        const json = await res.json().catch(() => ({}));
        if (mine === seq.current) {
          setResults(Array.isArray(json?.members) ? json.members : []);
          setSearched(true);
        }
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const visible = results.filter((r) => r.memberId !== ownMemberId);

  return (
    <div className="relative grid gap-10 fade-up">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40svh] opacity-60" style={HERO_SPOTLIGHT} />

      <header className="relative">
        <p className="overline text-tomato">{t("overline")}</p>
        <h2
          className="font-[family-name:var(--font-display)] mt-3 max-w-[18ch] font-black tracking-[-0.015em] text-foreground"
          style={{ fontSize: "clamp(2rem, 5.2vw, 3.6rem)", lineHeight: 0.95, textWrap: "balance" }}
        >
          {t("headingPrefix")} <span className="text-tomato">{t("headingAccent")}</span>
          {t("headingSuffix")}
        </h2>
        <p className="mt-4 max-w-xl text-foreground/70" style={{ fontSize: "16px", lineHeight: 1.55 }}>
          {t("tagline")}
        </p>
      </header>

      {value ? (
        <section className="paper-soft relative overflow-hidden rounded-[24px] border p-5 md:p-6" style={CARD} data-testid="invited-by-selected">
          <p className="relative overline text-tomato">{value.viaLink ? t("viaLink") : t("selectedLabel")}</p>
          <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 font-[family-name:var(--font-display)] text-xl font-black tracking-tight text-foreground">
              <UserCheck className="h-5 w-5 text-tomato" aria-hidden />
              {value.name || t("memberNumber", { id: value.memberId })}
              <span className="ui text-[11px] uppercase tracking-[0.22em] text-foreground/50">#{value.memberId}</span>
            </span>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="ui inline-flex min-h-11 items-center gap-1 rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.22em]"
              style={{ border: "1px solid hsl(var(--foreground) / 0.2)", color: "hsl(var(--foreground))", background: "transparent" }}
            >
              <X className="h-3 w-3" aria-hidden />
              {t("change")}
            </button>
          </div>
        </section>
      ) : (
        <section className="paper-soft relative overflow-hidden rounded-[24px] border p-5 md:p-6" style={CARD}>
          <p className="relative overline text-tomato">{t("searchLabel")}</p>
          <div
            className="relative mt-4 overflow-hidden rounded-[18px]"
            style={{ background: "hsl(var(--cream))", border: "1px solid hsl(var(--rule-warm) / 0.6)" }}
          >
            <label className="relative flex items-center gap-3 px-4 py-3.5 md:gap-4 md:px-5 md:py-4">
              <Search className="h-5 w-5 shrink-0 text-foreground/35" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchLabel")}
                className="w-full bg-transparent font-bold leading-tight focus:outline-none"
                style={{ fontSize: "clamp(1rem, 2vw, 1.3rem)", color: "hsl(var(--foreground))" }}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="relative mt-4 grid gap-2" role="listbox" aria-label={t("searchLabel")}>
            {searching && <p className="ui text-[12px] uppercase tracking-[0.24em] text-foreground/50">{t("searching")}</p>}
            {!searching && searched && visible.length === 0 && (
              <p className="ui text-[12px] uppercase tracking-[0.24em] text-foreground/55">{t("noResults")}</p>
            )}
            {visible.map((r) => (
              <button
                key={r.memberId}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onChange({ memberId: r.memberId, name: r.name })}
                className="flex min-h-11 items-center justify-between gap-3 rounded-[14px] px-4 py-2.5 text-left transition-colors hover:bg-[hsl(var(--butter)/0.18)]"
                style={{ border: "1px solid hsl(var(--rule-warm) / 0.5)", background: "hsl(var(--cream))" }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold text-foreground">{r.name}</span>
                  {r.city && <span className="block truncate text-xs text-foreground/55">{r.city}</span>}
                </span>
                <span className="ui shrink-0 text-[11px] uppercase tracking-[0.22em] text-foreground/50">#{r.memberId}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onChange(null)}
            className="ui mt-4 inline-flex min-h-11 items-center text-[11px] uppercase tracking-[0.22em] transition-colors hover:text-tomato"
            style={{ color: value === null ? "hsl(var(--tomato))" : "hsl(var(--foreground) / 0.6)", background: "none", border: "none" }}
            aria-pressed={value === null}
          >
            {value === null ? `✓ ${t("nobody")}` : t("nobody")}
          </button>
        </section>
      )}

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
          className="btn-pill-lg group"
          style={{ background: "hsl(var(--tomato))", color: "hsl(var(--cream))", boxShadow: "var(--shadow-soft)" }}
        >
          {value === undefined ? t("skip") : t("next")}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
