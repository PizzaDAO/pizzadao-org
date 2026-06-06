// app/ui/onboarding/ToppingPicker.tsx
//
// quattro-formaggi-54456 — Topping picker for NameStep.
// Mirrors the shape of `FilmPicker` (in NameStep.tsx) but for toppings,
// using the canonical `PIZZA_TOPPINGS` catalog + 28 JPG images served
// from `public/toppings/`.
//
// Ported from the Lovable mockup (`MafiaNamePage.tsx` — `ToppingDrawer`
// and `SelectedToppingCard`).
//
// Behavior:
//   - Click the field → drawer opens with search input + featured grid
//     of large image cards + supporting chips for the rest.
//   - Pick a topping → drawer closes; the picker shows a
//     `SelectedToppingCard` summary (image + name + descriptor + Change).
//   - Off-canon toppings (no catalog match) are accepted as free-text via
//     a "Use {query}" dashed CTA — the value is still a plain string, so
//     the wizard's existing free-text fallback continues to work.
"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  PIZZA_TOPPINGS,
  TOPPING_EMOJI,
  toppingDescriptorFor,
  toppingImageFor,
} from "@/app/lib/topping-images";

/* ──────────────────────────────────────────────────────────────────────────
   Featured set + flavor labels — visual only.
   The "Headliners" row shows large character-portrait cards; the rest of
   the catalog drops into the smaller chip rail below.
   ────────────────────────────────────────────────────────────────────────── */

const FEATURED_TOPPINGS = [
  "Pepperoni",
  "Mushroom",
  "Anchovy",
  "Basil",
  "Hot honey",
  "Sausage",
  "Pineapple",
  "Truffle",
] as const;

const TOPPING_ANNOTATION: Record<string, string> = {
  Pepperoni: "classic",
  Mushroom: "earthy",
  Anchovy: "dangerous",
  Basil: "respect",
  "Hot honey": "wild",
  Sausage: "trusted",
  Pineapple: "brave",
  Truffle: "good choice",
};

/* ──────────────────────────────────────────────────────────────────────────
   Reused surfaces — match `FilmPicker`'s editorial vocabulary.
   ────────────────────────────────────────────────────────────────────────── */

const FIELD_GLOW: CSSProperties = {
  background:
    "radial-gradient(120% 80% at 0% 0%, hsl(46 100% 62% / 0.14), transparent 60%), radial-gradient(80% 60% at 100% 100%, hsl(0 93% 60% / 0.06), transparent 70%)",
};

const SELECTED_CARD_STYLE: CSSProperties = {
  background: "hsl(var(--cream))",
  border: "1px solid hsl(var(--rule-warm) / 0.6)",
  boxShadow: "0 30px 60px -40px hsl(46 100% 50% / 0.35)",
};

const FIELD_SURFACE: CSSProperties = {
  background: "hsl(var(--cream))",
  border: "1px solid hsl(var(--rule-warm) / 0.6)",
  boxShadow: "0 30px 60px -40px hsl(46 100% 50% / 0.35)",
};

/* ──────────────────────────────────────────────────────────────────────────
   ToppingPicker
   ────────────────────────────────────────────────────────────────────────── */

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
};

export function ToppingPicker({ label, value, onChange }: Props) {
  const t = useTranslations("onboarding.topping");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Find canonical topping matching the current value (if any).
  const matchedTopping = useMemo(() => {
    if (!value.trim()) return undefined;
    const v = value.trim().toLowerCase();
    return PIZZA_TOPPINGS.find((t) => t.toLowerCase() === v);
  }, [value]);

  // When picker is closed and we have a canonical match, render the
  // SelectedToppingCard summary instead of the input field.
  if (matchedTopping && !open) {
    return (
      <SelectedToppingCard
        label={label}
        topping={matchedTopping}
        onChange={() => {
          setQuery("");
          setOpen(true);
          // focus the input after the field re-renders
          setTimeout(() => inputRef.current?.focus(), 80);
        }}
      />
    );
  }

  const effectiveQuery = (open ? query : value).trim().toLowerCase();

  const filteredToppings = useMemo(() => {
    if (!effectiveQuery) return PIZZA_TOPPINGS;
    return PIZZA_TOPPINGS.filter((t) =>
      t.toLowerCase().includes(effectiveQuery),
    );
  }, [effectiveQuery]);

  const handlePick = (t: string) => {
    onChange(t);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <p className="overline text-tomato">{label}</p>
      <div
        className="relative mt-4 overflow-hidden rounded-[28px] transition-shadow"
        style={FIELD_SURFACE}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={FIELD_GLOW}
        />
        <div
          aria-hidden
          className="grain pointer-events-none absolute inset-0 opacity-40"
        />
        <label className="relative flex items-center gap-4 px-5 py-5 md:gap-6 md:px-8 md:py-7">
          <Search
            className="h-5 w-5 shrink-0 text-foreground/35 md:h-6 md:w-6"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            value={open ? query : value}
            onFocus={() => {
              setQuery(value);
              setOpen(true);
            }}
            onChange={(e) => {
              setOpen(true);
              setQuery(e.target.value);
              onChange(e.target.value);
            }}
            placeholder={t("placeholder")}
            className="font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none"
            style={{
              fontSize: "clamp(1.4rem, 3.2vw, 2.4rem)",
              color: "hsl(var(--foreground))",
            }}
            aria-label={label.replace(/^§ \d+ · /, "")}
          />
          {open && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setQuery("");
              }}
              className="ui hidden shrink-0 rounded-full border border-foreground/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-foreground/55 transition-colors hover:border-tomato hover:text-tomato md:inline-flex"
            >
              <X className="mr-1 h-3 w-3" aria-hidden /> {t("close")}
            </button>
          )}
        </label>
      </div>

      {/* Descriptor / hint footer when the field shows free text */}
      {!open && value.trim() && !matchedTopping && (
        <p className="ui mt-3 text-[10px] uppercase tracking-[0.24em] text-foreground/45">
          {toppingDescriptorFor(value)}
        </p>
      )}
      {!open && !value.trim() && (
        <p className="ui mt-3 text-[10px] uppercase tracking-[0.24em] text-foreground/40">
          {t("hint")}
        </p>
      )}

      {/* Contextual drawer */}
      <div
        className={`overflow-hidden transition-[max-height,opacity,margin] duration-500 ease-[cubic-bezier(0.2,0.9,0.3,1)] ${
          open ? "mt-5 max-h-[78vh] opacity-100" : "mt-0 max-h-0 opacity-0"
        }`}
      >
        <div
          className="max-h-[74vh] overflow-y-auto overscroll-contain rounded-[24px] border p-4 md:p-6"
          style={{
            background: "hsl(var(--card) / 0.6)",
            borderColor: "hsl(var(--rule-warm) / 0.55)",
            backdropFilter: "blur(8px)",
          }}
        >
          <ToppingDrawer
            toppings={filteredToppings}
            query={open ? query : ""}
            onPick={handlePick}
          />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   SelectedToppingCard — chosen-topping summary surface.
   ────────────────────────────────────────────────────────────────────────── */

function SelectedToppingCard({
  label,
  topping,
  onChange,
}: {
  label: string;
  topping: string;
  onChange: () => void;
}) {
  const t = useTranslations("onboarding.topping");
  const img = toppingImageFor(topping);
  return (
    <div className="relative">
      <p className="overline text-tomato">{label}</p>
      <div
        className="paper-soft relative mt-4 flex items-center justify-between gap-6 overflow-hidden rounded-[28px] p-5 md:p-6"
        style={SELECTED_CARD_STYLE}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={FIELD_GLOW}
        />
        <div
          aria-hidden
          className="grain pointer-events-none absolute inset-0 opacity-40"
        />
        <div className="relative flex min-w-0 items-center gap-5 md:gap-6">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img}
              alt=""
              loading="lazy"
              className="h-20 w-20 shrink-0 rounded-2xl object-cover md:h-24 md:w-24"
              style={{ boxShadow: "0 12px 24px -14px hsl(20 30% 15% / 0.5)" }}
            />
          ) : (
            <span
              aria-hidden
              className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl text-4xl md:h-24 md:w-24"
              style={{ background: "hsl(var(--foreground) / 0.05)" }}
            >
              {TOPPING_EMOJI[topping] ?? "🍕"}
            </span>
          )}
          <div className="min-w-0">
            <h3
              className="font-[family-name:var(--font-display)] font-black leading-[0.95] tracking-[-0.01em] text-foreground"
              style={{ fontSize: "clamp(1.6rem, 3.8vw, 2.6rem)" }}
            >
              {topping}
            </h3>
            <p className="ui mt-2 text-[11px] uppercase tracking-[0.22em] text-foreground/50">
              {toppingDescriptorFor(topping)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onChange}
          className="ui relative shrink-0 rounded-full border border-foreground/20 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-foreground/60 transition-colors hover:border-tomato hover:text-tomato"
        >
          {t("change")}
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   ToppingDrawer — search results / featured grid + supporting chips.
   Ported from the Lovable mockup's `ToppingDrawer`. The two-tier layout
   (large headliners + small chips) is preserved so the picker doesn't
   feel monotonous.
   ────────────────────────────────────────────────────────────────────────── */

function ToppingDrawer({
  toppings,
  query,
  onPick,
}: {
  toppings: string[];
  query: string;
  onPick: (t: string) => void;
}) {
  const t = useTranslations("onboarding.topping");
  const q = query.trim().toLowerCase();
  const featured = FEATURED_TOPPINGS.filter((top) => toppings.includes(top));
  const supporting = toppings.filter(
    (top) => !FEATURED_TOPPINGS.includes(top as (typeof FEATURED_TOPPINGS)[number]),
  );

  return (
    <div className="relative">
      <p className="ui relative text-[10px] uppercase tracking-[0.28em] text-foreground/45">
        {q ? t("matches") : t("headliners")}
      </p>

      {/* FEATURED — large character-portrait cards */}
      {featured.length > 0 && (
        <div className="relative mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {featured.map((top, i) => {
            const img = toppingImageFor(top);
            const annotation = TOPPING_ANNOTATION[top] ?? "respect";
            const rot = (((i * 7) % 5) - 2) * 0.25;
            return (
              <button
                key={top}
                type="button"
                onClick={() => onPick(top)}
                style={{
                  transform: `rotate(${rot}deg)`,
                  background: "hsl(var(--cream))",
                  borderColor: "hsl(var(--foreground) / 0.1)",
                  boxShadow: "0 14px 30px -18px hsl(20 30% 15% / 0.4)",
                }}
                className="group relative flex flex-col overflow-visible rounded-[20px] border text-left transition-all duration-300 hover:-translate-y-1.5 hover:rotate-0 hover:scale-[1.03] hover:border-tomato/60 focus-visible:-translate-y-1.5 focus-visible:rotate-0 focus-visible:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato/60"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-2 -z-10 rounded-[24px] opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
                  style={{
                    background:
                      "radial-gradient(60% 60% at 50% 40%, hsl(46 100% 62% / 0.6), transparent 70%)",
                  }}
                />
                <span
                  className="relative block aspect-square w-full overflow-hidden rounded-t-[20px]"
                  style={{ background: "hsl(var(--foreground) / 0.05)" }}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt=""
                      loading="lazy"
                      className="h-full w-full scale-[1.04] object-cover transition-transform duration-500 group-hover:scale-[1.1]"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-5xl">
                      {TOPPING_EMOJI[top] ?? "🍕"}
                    </span>
                  )}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(120% 80% at 30% 20%, hsl(46 80% 75% / 0.18), transparent 55%), radial-gradient(120% 80% at 80% 100%, hsl(20 50% 10% / 0.35), transparent 60%)",
                    }}
                  />
                  <span
                    aria-hidden
                    className="handwritten pointer-events-none absolute -top-3 right-2 rotate-[-8deg] rounded-full px-2.5 py-1 text-[12px] text-tomato opacity-0 transition-all duration-300 group-hover:-top-4 group-hover:opacity-100 group-focus-visible:-top-4 group-focus-visible:opacity-100"
                    style={{
                      background: "hsl(var(--cream))",
                      boxShadow: "0 6px 14px -8px hsl(0 93% 60% / 0.5)",
                    }}
                  >
                    {annotation}
                  </span>
                </span>
                <span className="flex flex-col gap-0.5 px-3 py-3">
                  <span className="font-[family-name:var(--font-display)] text-[16px] font-black leading-tight tracking-tight text-foreground">
                    {top}
                  </span>
                  <span className="ui text-[9.5px] uppercase tracking-[0.18em] text-foreground/45">
                    {toppingDescriptorFor(top)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* SUPPORTING — smaller, calmer chips */}
      {supporting.length > 0 && (
        <>
          <p className="ui relative mt-10 text-[10px] uppercase tracking-[0.28em] text-foreground/40">
            {t("supporting")}
          </p>
          <div className="relative mt-4 flex flex-wrap gap-2.5">
            {supporting.map((top, i) => {
              const rot = (((i * 11) % 5) - 2) * 0.2;
              return (
                <button
                  key={top}
                  type="button"
                  onClick={() => onPick(top)}
                  style={{
                    transform: `rotate(${rot}deg)`,
                    background: "hsl(var(--cream) / 0.8)",
                    borderColor: "hsl(var(--foreground) / 0.12)",
                    boxShadow: "0 4px 10px -8px hsl(20 30% 15% / 0.35)",
                  }}
                  className="group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-left transition-all hover:-translate-y-0.5 hover:rotate-0 hover:border-tomato/60"
                >
                  <span className="text-sm leading-none">
                    {TOPPING_EMOJI[top] ?? "·"}
                  </span>
                  <span className="font-[family-name:var(--font-display)] text-[13.5px] font-bold tracking-tight text-foreground/85">
                    {top}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Off-canon CTA — present free-text as a viable option */}
      {q && !toppings.some((top) => top.toLowerCase() === q) && (
        <button
          type="button"
          onClick={() => onPick(query.trim())}
          className="relative mt-6 inline-flex items-center gap-2 rounded-full border-2 border-dashed px-5 py-2.5 transition-colors"
          style={{
            borderColor: "hsl(var(--tomato) / 0.4)",
            background: "hsl(var(--tomato) / 0.05)",
            color: "hsl(var(--tomato))",
          }}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          <span className="font-[family-name:var(--font-display)] text-[16px] font-black">
            {t("useCustom", { query: query.trim() })}
          </span>
          <span
            className="ui text-[9px] uppercase tracking-[0.22em]"
            style={{ color: "hsl(var(--tomato) / 0.7)" }}
          >
            {t("offCanon")}
          </span>
        </button>
      )}

      <p className="ui relative mt-8 text-[10px] uppercase tracking-[0.24em] text-foreground/35">
        {t("footer")}
      </p>
    </div>
  );
}

export default ToppingPicker;
