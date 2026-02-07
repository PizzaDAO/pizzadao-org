// app/ui/onboarding/steps/CityStep.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { btn, input } from "../styles";
import { Field } from "../Field";
import type { CityPrediction } from "../types";

type Props = {
  city: string;
  onChange: (city: string) => void;
  onRegionResolved?: (region: string | null, countryCode: string | null) => void;
  onNext: () => void;
  onBack: () => void;
};

export function CityStep({ city, onChange, onRegionResolved, onNext, onBack }: Props) {
  const canProceed = city.trim().length > 0;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Field label="City">
        <CityAutocomplete value={city} onChange={onChange} onRegionResolved={onRegionResolved} />
      </Field>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onBack} style={btn("secondary")}>
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          style={btn("primary", !canProceed)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

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
        <div style={{ position: "absolute", right: 10, top: 10, opacity: 0.6, fontSize: 12 }}>...</div>
      )}

      {open && items.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            marginTop: 6,
            border: "1px solid rgba(0,0,0,0.18)",
            borderRadius: 12,
            background: "white",
            boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            overflow: "hidden",
            zIndex: 50,
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
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                background: "white",
                color: "#000000",
                cursor: "pointer",
              }}
            >
              {it.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
