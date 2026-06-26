// app/ui/onboarding/steps/CityStep.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite. The Props interface, API calls (/api/city-autocomplete,
// /api/city-region, /api/city-telegram), state, and callbacks are unchanged.
// arugula-30866 — i18n via next-intl (onboarding.city.*).
"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, MapPin, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CityPrediction } from "../types";

type TelegramMatch = {
  found: boolean;
  city?: string;
  country?: string;
  region?: string;
  chatUrl?: string;
};

type Props = {
  city: string;
  onChange: (city: string) => void;
  onRegionResolved?: (region: string | null, countryCode: string | null) => void;
  onNext: () => void;
  onBack: () => void;
};

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.22), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

export function CityStep({ city, onChange, onRegionResolved, onNext, onBack }: Props) {
  const t = useTranslations("onboarding.city");
  const canProceed = city.trim().length > 0;
  const [telegramMatch, setTelegramMatch] = useState<TelegramMatch | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const lastLookupRef = useRef<string>("");

  // Fire-and-forget Telegram group lookup when city changes
  useEffect(() => {
    const trimmed = city.trim();
    if (trimmed === lastLookupRef.current) return;

    if (trimmed.length < 3) {
      setTelegramMatch(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      lastLookupRef.current = trimmed;
      setTelegramLoading(true);
      try {
        const res = await fetch("/api/city-telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: trimmed }),
        });
        if (res.ok) {
          const data: TelegramMatch = await res.json();
          setTelegramMatch(data);
        } else {
          setTelegramMatch(null);
        }
      } catch {
        setTelegramMatch(null);
      } finally {
        setTelegramLoading(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [city]);

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

      {/* ─── City autocomplete card ─────────────────────────────── */}
      <section className="grid gap-4">
        <p className="overline text-tomato">{t("fieldLabel")}</p>
        <CityAutocomplete
          value={city}
          onChange={onChange}
          onRegionResolved={onRegionResolved}
          placeholder={t("inputPlaceholder")}
          ariaLabel={t("inputAriaLabel")}
        />

        {telegramLoading && (
          <p className="ui text-[11px] uppercase tracking-[0.24em] text-foreground/45">
            {t("lookingForChapter")}
          </p>
        )}

        {telegramMatch?.found && telegramMatch.chatUrl && (
          <TelegramInvite
            chapterCity={telegramMatch.city || ""}
            country={telegramMatch.country || ""}
            chatUrl={telegramMatch.chatUrl}
          />
        )}
      </section>

      {/* ─── Actions ────────────────────────────────────────────── */}
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
   CinematicInput-style city autocomplete
   ────────────────────────────────────────────────────────────────────────── */

function CityAutocomplete({
  value,
  onChange,
  onRegionResolved,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onRegionResolved?: (region: string | null, countryCode: string | null) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CityPrediction[]>([]);
  const [loading, setLoading] = useState(false);

  const suppressForValueRef = useRef<string>(value);

  useEffect(() => {
    const q = value.trim();

    if (q && q === suppressForValueRef.current) {
      setOpen(false);
      setItems([]);
      setLoading(false);
      return;
    }

    if (q.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }

    const t = window.setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/city-autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: q }),
        });
        const data = await res.json();
        setItems(Array.isArray(data?.predictions) ? data.predictions : []);
        setOpen(true);
      } catch {
        /* ignore — user can still type manually */
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(t);
  }, [value]);

  function resolveRegion(placeId: string) {
    if (!onRegionResolved) return;
    fetch("/api/city-region", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ place_id: placeId }),
    })
      .then((r) => r.json())
      .then((data) => {
        onRegionResolved(data?.region ?? null, data?.countryCode ?? null);
      })
      .catch(() => {
        /* non-blocking */
      });
  }

  return (
    <div className="relative">
      <div
        className="relative overflow-hidden rounded-[24px] transition-shadow"
        style={{
          background: "hsl(var(--cream))",
          border: "1px solid hsl(var(--rule-warm) / 0.6)",
          boxShadow: "0 30px 60px -40px hsl(46 100% 50% / 0.35)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(120% 80% at 0% 0%, hsl(46 100% 62% / 0.14), transparent 60%), radial-gradient(80% 60% at 100% 100%, hsl(0 93% 60% / 0.06), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="grain pointer-events-none absolute inset-0 opacity-40"
        />
        <label className="relative flex items-center gap-3 px-4 py-4 md:gap-4 md:px-6 md:py-5">
          <MapPin
            className="h-5 w-5 shrink-0 text-foreground/35 md:h-6 md:w-6"
            aria-hidden
          />
          <input
            type="text"
            value={value}
            onChange={(e) => {
              suppressForValueRef.current = "";
              onChange(e.target.value);
            }}
            onFocus={() =>
              value.trim().length >= 2 && items.length > 0 && setOpen(true)
            }
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            placeholder={placeholder}
            autoComplete="off"
            aria-label={ariaLabel}
            className="font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none"
            style={{
              fontSize: "clamp(1.3rem, 3vw, 2.1rem)",
              color: "hsl(var(--foreground))",
            }}
          />
          {loading && (
            <Sparkles
              className="h-4 w-4 shrink-0 animate-pulse text-tomato/70"
              aria-hidden
            />
          )}
        </label>
      </div>

      {/* Suggestions dropdown */}
      {open && items.length > 0 && (
        <div
          className="paper-soft absolute left-0 right-0 top-full mt-2 z-50 overflow-hidden rounded-[20px] border"
          style={{
            background: "hsl(var(--cream))",
            borderColor: "hsl(var(--rule-warm) / 0.55)",
            boxShadow: "var(--shadow-lifted)",
          }}
        >
          {items.slice(0, 8).map((it) => (
            <button
              key={it.place_id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                suppressForValueRef.current = it.description;
                onChange(it.description);
                resolveRegion(it.place_id);
                setOpen(false);
                setItems([]);
              }}
              className="relative w-full cursor-pointer border-0 bg-transparent px-5 py-3 text-left text-foreground transition-colors hover:bg-tomato/10"
              style={{ fontSize: "15px" }}
            >
              {it.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Telegram chapter invite (tomato chip)
   ────────────────────────────────────────────────────────────────────────── */

function TelegramInvite({
  chapterCity,
  country,
  chatUrl,
}: {
  chapterCity: string;
  country: string;
  chatUrl: string;
}) {
  const t = useTranslations("onboarding.city");
  const location = country ? `${chapterCity}, ${country}` : chapterCity;

  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[20px] border p-5"
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="relative">
        <p className="overline text-tomato">{t("telegramOverline")}</p>
        <h3
          className="font-[family-name:var(--font-display)] mt-2 font-black tracking-[-0.01em] text-foreground"
          style={{ fontSize: "clamp(1.1rem, 2.4vw, 1.5rem)", lineHeight: 1.1 }}
        >
          {t("telegramChapterTitle", { city: chapterCity })}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-foreground/70">
          {t.rich("telegramDescription", {
            location,
            b: (chunks) => <b className="text-foreground">{chunks}</b>,
          })}
        </p>
        <a
          href={chatUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-pill group mt-4 inline-flex no-underline"
          style={{
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <TelegramIcon />
          {t("telegramCta")}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </a>
      </div>
    </div>
  );
}

function TelegramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}
