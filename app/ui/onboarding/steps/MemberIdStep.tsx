// app/ui/onboarding/steps/MemberIdStep.tsx
"use client";

import { useEffect, useState } from "react";
import { btn, input } from "../styles";
import { Field } from "../Field";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
};

export function MemberIdStep({ value, onChange, onNext, onBack }: Props) {
  const [suggestions, setSuggestions] = useState<number[]>([]);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<{
    id: string;
    status: "available" | "taken" | "invalid" | null;
  }>({
    id: "",
    status: null,
  });
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
        // ignore
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
    <div className="grid gap-4">
      {loadingSuggestions ? (
        <div className="text-muted-foreground/70">Loading suggestions...</div>
      ) : (
        <div className="grid gap-2.5">
          <div className="text-sm text-muted-foreground">Next available IDs:</div>
          <div className="flex gap-2.5 flex-wrap">
            {suggestions.map((id) => (
              <button
                key={id}
                onClick={() => onChange(String(id))}
                style={{
                  ...btn(value === String(id) ? "accent" : "secondary"),
                  padding: "8px 16px",
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-rule pt-4">
        <Field label="Or check a specific number:">
          <div className="flex gap-2.5">
            <input
              type="number"
              min={1}
              value={availability.id}
              onChange={(e) => setAvailability({ id: e.target.value, status: null })}
              placeholder="Enter ID"
              style={input()}
            />
            <button
              onClick={() => checkAvailability(availability.id)}
              disabled={checking || !availability.id}
              style={btn("secondary", checking || !availability.id)}
            >
              {checking ? "Checking..." : "Check"}
            </button>
          </div>
        </Field>

        {availability.status && (
          <div className="mt-2 text-sm font-semibold">
            {availability.status === "available" && (
              <div className="flex items-center gap-2 text-foreground">
                <span>ID {availability.id} is available!</span>
                <button
                  onClick={() => onChange(availability.id)}
                  className="px-2 py-1 rounded-md text-xs cursor-pointer bg-primary text-primary-foreground border-0"
                >
                  Pick this
                </button>
              </div>
            )}
            {availability.status === "taken" && (
              <span className="text-destructive">ID {availability.id} is already taken.</span>
            )}
            {availability.status === "invalid" && (
              <span className="text-tomato">Invalid ID.</span>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 text-sm">
        Selected Member ID: <b className="text-foreground">{value || "(none)"}</b>
      </div>

      <div className="flex gap-2.5 mt-2">
        <button onClick={onBack} style={btn("secondary")}>
          Back
        </button>
        <button onClick={onNext} disabled={!value} style={btn("accent", !value)}>
          Next
        </button>
      </div>
    </div>
  );
}
