// app/ui/onboarding/steps/MemberIdStep.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite of the member-ID entry / lookup. Props, API calls
// (/api/member-id, /api/member-id?check=...) and all state are unchanged.
"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Hash } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
};

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.22), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.10), transparent 65%)",
};

export function MemberIdStep({ value, onChange, onNext, onBack }: Props) {
  const [suggestions, setSuggestions] = useState<number[]>([]);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<{
    id: string;
    status: "available" | "taken" | "invalid" | null;
  }>({ id: "", status: null });
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingSuggestions(true);
        const res = await fetch("/api/member-id");
        const data = await res.json();
        if (alive && data.suggestions) {
          setSuggestions(data.suggestions);
        }
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoadingSuggestions(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function checkAvailability(id: string) {
    if (!id.trim()) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/member-id?check=${id}`);
      const data = await res.json();
      if (data.error) {
        setAvailability({ id, status: "invalid" });
      } else {
        setAvailability({ id, status: data.available ? "available" : "taken" });
      }
    } catch {
      setAvailability({ id, status: "invalid" });
    } finally {
      setChecking(false);
    }
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
        <p className="overline text-tomato">§ 04 · Family number</p>
        <h2
          className="font-[family-name:var(--font-display)] mt-3 max-w-[18ch] font-black tracking-[-0.015em] text-foreground"
          style={{
            fontSize: "clamp(2rem, 5.2vw, 3.6rem)",
            lineHeight: 0.95,
            textWrap: "balance",
          }}
        >
          Pick your <span className="text-tomato">Member ID</span>.
        </h2>
        <p
          className="mt-4 max-w-xl text-foreground/70"
          style={{ fontSize: "16px", lineHeight: 1.55 }}
        >
          A small number that belongs to you forever. Take one of the next
          available, or claim a specific number.
        </p>
      </header>

      {/* ─── Suggestions card ──────────────────────────────────── */}
      <section
        className="paper-soft relative overflow-hidden rounded-[24px] border p-5 md:p-6"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--rule-warm) / 0.55)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <p className="relative overline text-tomato">§ Next available</p>

        {loadingSuggestions ? (
          <p className="relative mt-3 ui text-[12px] uppercase tracking-[0.24em] text-foreground/50">
            Pulling fresh numbers from the ledger…
          </p>
        ) : (
          <div className="relative mt-4 flex flex-wrap gap-2.5">
            {suggestions.map((id) => {
              const picked = value === String(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange(String(id))}
                  className="ui inline-flex min-h-11 items-center gap-1 rounded-full px-4 py-2 text-sm font-bold transition-all"
                  style={{
                    background: picked
                      ? "hsl(var(--tomato))"
                      : "hsl(var(--cream))",
                    color: picked
                      ? "hsl(var(--cream))"
                      : "hsl(var(--foreground))",
                    border: picked
                      ? "1px solid hsl(var(--tomato))"
                      : "1px solid hsl(var(--rule-warm) / 0.6)",
                    boxShadow: picked ? "var(--shadow-soft)" : undefined,
                    fontFamily: "var(--font-display), system-ui, sans-serif",
                  }}
                >
                  <Hash className="h-3.5 w-3.5 opacity-70" />
                  {id}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Specific-number card ──────────────────────────────── */}
      <section
        className="paper-soft relative overflow-hidden rounded-[24px] border p-5 md:p-6"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--rule-warm) / 0.55)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <p className="relative overline text-tomato">§ Or claim a specific number</p>

        <div
          className="relative mt-4 overflow-hidden rounded-[18px]"
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
          <label className="relative flex items-center gap-3 px-4 py-3.5 md:gap-4 md:px-5 md:py-4">
            <Hash
              className="h-5 w-5 shrink-0 text-foreground/35"
              aria-hidden
            />
            <input
              type="number"
              min={1}
              value={availability.id}
              onChange={(e) =>
                setAvailability({ id: e.target.value, status: null })
              }
              placeholder="Enter ID"
              aria-label="Enter Member ID to check"
              className="font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none"
              style={{
                fontSize: "clamp(1.1rem, 2.2vw, 1.6rem)",
                color: "hsl(var(--foreground))",
              }}
            />
            <button
              type="button"
              onClick={() => checkAvailability(availability.id)}
              disabled={checking || !availability.id}
              className="ui shrink-0 rounded-full px-4 py-2 text-[11px] uppercase tracking-[0.22em] transition-colors disabled:opacity-40"
              style={{
                border: "1px solid hsl(var(--foreground) / 0.2)",
                color: "hsl(var(--foreground))",
                background: "transparent",
              }}
            >
              {checking ? "Checking…" : "Check"}
            </button>
          </label>
        </div>

        {availability.status && (
          <div className="relative mt-4">
            {availability.status === "available" && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="ui inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.22em] text-foreground">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: "hsl(var(--tomato))" }}
                  />
                  ID {availability.id} is available
                </span>
                <button
                  type="button"
                  onClick={() => onChange(availability.id)}
                  className="btn-pill group"
                  style={{
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                  }}
                >
                  Pick this
                  <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </button>
              </div>
            )}
            {availability.status === "taken" && (
              <p className="ui text-[12px] uppercase tracking-[0.24em] text-destructive">
                ID {availability.id} is already taken.
              </p>
            )}
            {availability.status === "invalid" && (
              <p className="ui text-[12px] uppercase tracking-[0.24em] text-tomato">
                Invalid ID.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ─── Selected summary ──────────────────────────────────── */}
      <p className="ui text-[11px] uppercase tracking-[0.24em] text-foreground/55">
        Selected Member ID ·{" "}
        <b className="text-foreground">{value || "(none)"}</b>
      </p>

      {/* ─── Actions ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="ui inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:text-tomato"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!value}
          className="btn-pill-lg group"
          style={{
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          Next
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
