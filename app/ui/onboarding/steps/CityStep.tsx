// app/ui/onboarding/steps/CityStep.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { btn, input } from "../styles";
import { Field } from "../Field";
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

export function CityStep({ city, onChange, onRegionResolved, onNext, onBack }: Props) {
  const canProceed = city.trim().length > 0;
  const [telegramMatch, setTelegramMatch] = useState<TelegramMatch | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const lastLookupRef = useRef<string>("");

  // Fire-and-forget Telegram group lookup when city changes
  useEffect(() => {
    const trimmed = city.trim();

    // Don't re-lookup the same city
    if (trimmed === lastLookupRef.current) return;

    // Need at least 3 chars to attempt a match
    if (trimmed.length < 3) {
      setTelegramMatch(null);
      return;
    }

    // Debounce the lookup — wait for user to settle on a city
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
        // Non-blocking — silently ignore errors
        setTelegramMatch(null);
      } finally {
        setTelegramLoading(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [city]);

  return (
    <div className="grid gap-3">
      <Field label="City">
        <CityAutocomplete value={city} onChange={onChange} onRegionResolved={onRegionResolved} />
      </Field>

      {/* Telegram group invite prompt */}
      {telegramMatch?.found && telegramMatch.chatUrl && (
        <TelegramInvite
          chapterCity={telegramMatch.city || ""}
          country={telegramMatch.country || ""}
          chatUrl={telegramMatch.chatUrl}
        />
      )}

      {telegramLoading && (
        <div className="text-xs text-muted-foreground/70">
          Looking for a local PizzaDAO chapter...
        </div>
      )}

      <div className="flex gap-2.5">
        <button onClick={onBack} style={btn("secondary")}>
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          style={btn("accent", !canProceed)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Telegram Invite Card
// ============================================================================

function TelegramInvite({
  chapterCity,
  country,
  chatUrl,
}: {
  chapterCity: string;
  country: string;
  chatUrl: string;
}) {
  const location = country ? `${chapterCity}, ${country}` : chapterCity;

  return (
    <div className="p-3.5 rounded-[--radius] border border-rule bg-secondary grid gap-2">
      <div className="font-[family-name:var(--font-display)] font-bold text-base text-foreground">
        PizzaDAO {chapterCity} Chapter
      </div>
      <div className="text-sm text-muted-foreground">
        There&apos;s a local PizzaDAO community in {location}! Join the group chat to
        connect with pizza fam near you.
      </div>
      <a
        href={chatUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-[--radius] no-underline cursor-pointer w-fit text-sm font-semibold text-cream"
        style={{
          background: "#0088cc",
          padding: "8px 14px",
        }}
      >
        <TelegramIcon />
        Join Telegram Group
      </a>
    </div>
  );
}

function TelegramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

// ============================================================================
// City Autocomplete
// ============================================================================

function CityAutocomplete({
  value,
  onChange,
  onRegionResolved,
}: {
  value: string;
  onChange: (v: string) => void;
  onRegionResolved?: (region: string | null, countryCode: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CityPrediction[]>([]);
  const [loading, setLoading] = useState(false);

  // If the user picked an item, we don't want the effect to re-open for that exact value.
  const suppressForValueRef = useRef<string>(value);

  useEffect(() => {
    const q = value.trim();

    // If this value was just selected from the dropdown, suppress fetching + reopening.
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
        // ignore UI errors; user can still type manually
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(t);
  }, [value]);

  /** Fire-and-forget: resolve region from a place_id */
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
        // Non-blocking: if region resolution fails, just skip it
      });
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => {
          // user is typing again; allow future autocompletes
          suppressForValueRef.current = "";
          onChange(e.target.value);
        }}
        onFocus={() => value.trim().length >= 2 && items.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="New York, NY"
        style={input()}
        autoComplete="off"
      />

      {loading && (
        <div className="absolute right-2.5 top-2.5 text-xs text-muted-foreground/70">...</div>
      )}

      {open && items.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1.5 rounded-[--radius] border border-rule bg-card overflow-hidden z-50"
          style={{ boxShadow: "0 10px 30px hsl(var(--ink) / 0.08)" }}
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
              className="w-full text-left px-3 py-2.5 border-0 bg-card text-card-foreground hover:bg-secondary cursor-pointer"
            >
              {it.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
