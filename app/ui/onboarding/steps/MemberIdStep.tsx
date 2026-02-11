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
    <div style={{ display: "grid", gap: 16 }}>
      {loadingSuggestions ? (
        <div style={{ opacity: 0.6 }}>Loading suggestions...</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ opacity: 0.7, fontSize: 13 }}>Next available IDs:</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {suggestions.map((id) => (
              <button
                key={id}
                onClick={() => onChange(String(id))}
                style={{
                  ...btn(value === String(id) ? "primary" : "secondary"),
                  padding: "8px 16px",
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 16 }}>
        <Field label="Or check a specific number:">
          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="number"
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
          <div
            style={{
              marginTop: 8,
              fontSize: 14,
              fontWeight: 600,
              color:
                availability.status === "available"
                  ? "green"
                  : availability.status === "taken"
                    ? "red"
                    : "orange",
            }}
          >
            {availability.status === "available" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>ID {availability.id} is available!</span>
                <button
                  onClick={() => onChange(availability.id)}
                  style={{
                    backgroundColor: "black",
                    color: 'var(--color-btn-primary-text)',
                    border: "none",
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Pick this
                </button>
              </div>
            )}
            {availability.status === "taken" && `ID ${availability.id} is already taken.`}
            {availability.status === "invalid" && "Invalid ID."}
          </div>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        Selected Member ID: <b>{value || "(none)"}</b>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={onBack} style={btn("secondary")}>
          Back
        </button>
        <button onClick={onNext} disabled={!value} style={btn("primary", !value)}>
          Next
        </button>
      </div>
    </div>
  );
}
