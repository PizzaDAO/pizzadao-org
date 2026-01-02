// app/ui/OnboardingWizard.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CREWS, TURTLES } from "./constants";

type NamegenResponse = {
  cached: boolean;
  topping: string;
  mafiaMovieTitle: string;
  resolvedMovieTitle: string;
  tmdbMovieId: string;
  releaseDate: string;
  style: "balanced" | "serious" | "goofy";
  suggestions: string[];
};

type CityPrediction = { description: string; place_id: string };

type WizardState = {
  step: 1 | 2 | 3 | 4 | 5;
  sessionId: string;

  topping: string;
  mafiaMovieTitle: string;
  style: "balanced" | "serious" | "goofy";

  resolvedMovieTitle?: string;
  tmdbMovieId?: string;
  releaseDate?: string;

  suggestions?: string[];
  mafiaName?: string;

  city: string;

  // ✅ multi-select turtles
  turtles: string[];

  crews: string[];

  seenNames: string[];

  submitting: boolean;
  error?: string;
  success?: boolean;
};

function uuidLike() {
  return `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

// bump key to avoid old saved state shape conflicts (turtle -> turtles)
const LS_KEY = "mob_pizza_onboarding_v3";

export default function OnboardingWizard() {
  const [s, setS] = useState<WizardState>(() => ({
    step: 1,
    sessionId: uuidLike(),
    topping: "",
    mafiaMovieTitle: "",
    style: "balanced",
    city: "",
    turtles: [],
    crews: [],
    seenNames: [],
    submitting: false,
  }));

  // Load draft from localStorage (with migration for old "turtle" string)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);

        const migratedTurtles: string[] = Array.isArray(parsed?.turtles)
          ? parsed.turtles
          : parsed?.turtle
          ? [String(parsed.turtle)]
          : [];

        setS((prev) => ({
          ...prev,
          ...parsed,
          turtles: migratedTurtles,
          submitting: false,
          error: undefined,
          success: false,
          seenNames: Array.isArray(parsed?.seenNames) ? parsed.seenNames : [],
        }));
      }
    } catch {}
  }, []);

  // Persist draft
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ ...s, submitting: false, error: undefined, success: false })
      );
    } catch {}
  }, [
    s.step,
    s.topping,
    s.mafiaMovieTitle,
    s.style,
    s.suggestions,
    s.mafiaName,
    s.city,
    s.turtles,
    s.crews,
    s.sessionId,
    s.seenNames,
  ]);

  const canGenerate = s.topping.trim().length > 0 && s.mafiaMovieTitle.trim().length > 0;

  function mergeSeen(prevSeen: string[], newNames: string[]) {
    const cleaned = newNames.map((x) => String(x ?? "").trim()).filter(Boolean);
    return Array.from(new Set([...(prevSeen ?? []), ...cleaned]));
  }

  async function generateNames(force = false) {
    setS((p) => ({ ...p, submitting: true, error: undefined, success: false }));

    try {
      const res = await fetch("/api/namegen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topping: s.topping,
          movieTitle: s.mafiaMovieTitle,
          style: s.style,
          force,
          exclude: force ? s.seenNames : [],
        }),
      });

      const data = (await res.json()) as NamegenResponse | any;
      if (!res.ok) throw new Error(data?.error || "Failed to generate names");

      setS((p) => ({
        ...p,
        submitting: false,
        error: undefined,
        suggestions: data.suggestions,
        resolvedMovieTitle: data.resolvedMovieTitle,
        tmdbMovieId: data.tmdbMovieId,
        releaseDate: data.releaseDate,
        seenNames: mergeSeen(p.seenNames, data.suggestions ?? []),
      }));
    } catch (e: any) {
      setS((p) => ({ ...p, submitting: false, error: e?.message || "Failed", success: false }));
    }
  }

  function pickName(name: string) {
    setS((p) => ({
      ...p,
      mafiaName: name,
      step: 2,
      error: undefined,
      seenNames: mergeSeen(p.seenNames, [name]),
    }));
  }

  function toggleCrew(id: string) {
    setS((p) => {
      const has = p.crews.includes(id);
      return { ...p, crews: has ? p.crews.filter((x) => x !== id) : [...p.crews, id] };
    });
  }

  // ✅ multi-select turtle toggle
  function toggleTurtle(t: string) {
    setS((p) => {
      const has = p.turtles.includes(t);
      return { ...p, turtles: has ? p.turtles.filter((x) => x !== t) : [...p.turtles, t] };
    });
  }

  async function submitAll() {
    setS((p) => ({ ...p, submitting: true, error: undefined, success: false }));

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "web",
          sessionId: s.sessionId,

          mafiaName: s.mafiaName,
          topping: s.topping,

          mafiaMovieTitle: s.mafiaMovieTitle,
          resolvedMovieTitle: s.resolvedMovieTitle,
          tmdbMovieId: s.tmdbMovieId,
          releaseDate: s.releaseDate,

          city: s.city,

          // ✅ send both for compatibility
          turtle: s.turtles.join(", "),
          turtles: s.turtles,

          crews: s.crews,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Submit failed");

      setS((p) => ({ ...p, submitting: false, success: true, error: undefined, step: 5 }));
    } catch (e: any) {
      setS((p) => ({
        ...p,
        submitting: false,
        error: e?.message || "Submit failed",
        success: false,
      }));
    }
  }

  const stepTitle = useMemo(() => {
    switch (s.step) {
      case 1:
        return "1) Pick your mafia name";
      case 2:
        return "2) Your city";
      case 3:
        return "3) Choose Ninja Turtles";
      case 4:
        return "4) Choose PizzaDAO crews";
      case 5:
        return "Done";
    }
  }, [s.step]);

  return (
    <div style={card()}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "baseline",
        }}
      >
        <h2 style={{ margin: 0 }}>{stepTitle}</h2>
        <button
          onClick={() => {
            try {
              localStorage.removeItem(LS_KEY);
            } catch {}
            setS({
              step: 1,
              sessionId: uuidLike(),
              topping: "",
              mafiaMovieTitle: "",
              style: "balanced",
              city: "",
              turtles: [],
              crews: [],
              seenNames: [],
              submitting: false,
            });
          }}
          style={btn("secondary")}
        >
          Reset
        </button>
      </div>

      {s.error && <div style={alert("error")}>{s.error}</div>}
      {s.success && <div style={alert("success")}>Saved to Google Sheet ✅</div>}

      {s.step === 1 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Favorite pizza topping">
              <input
                value={s.topping}
                onChange={(e) => setS((p) => ({ ...p, topping: e.target.value }))}
                placeholder="Pepperoni"
                style={input()}
              />
            </Field>

            <Field label="Favorite mafia movie">
              <input
                value={s.mafiaMovieTitle}
                onChange={(e) => setS((p) => ({ ...p, mafiaMovieTitle: e.target.value }))}
                placeholder="Goodfellas"
                style={input()}
              />
            </Field>
          </div>

          <Field label="Vibe">
            <select
              value={s.style}
              onChange={(e) => setS((p) => ({ ...p, style: e.target.value as any }))}
              style={input()}
            >
              <option value="balanced">Balanced</option>
              <option value="serious">Serious</option>
              <option value="goofy">Goofy</option>
            </select>
          </Field>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => generateNames(false)}
              disabled={!canGenerate || s.submitting}
              style={btn("primary", !canGenerate || s.submitting)}
            >
              {s.submitting ? "Generating…" : "Generate 3 names"}
            </button>

            {s.suggestions && (
              <button
                onClick={() => generateNames(true)}
                disabled={!canGenerate || s.submitting}
                style={btn("secondary", !canGenerate || s.submitting)}
                title="Regenerate (won’t repeat anything you’ve already seen)"
              >
                {s.submitting ? "Regenerating…" : "Regenerate (no repeats)"}
              </button>
            )}

            {s.resolvedMovieTitle && (
              <span style={{ opacity: 0.75 }}>
                Matched: <b>{s.resolvedMovieTitle}</b>{" "}
                {s.releaseDate ? `(${s.releaseDate.slice(0, 4)})` : ""}
              </span>
            )}
          </div>

          {s.seenNames.length > 0 && (
            <div style={{ opacity: 0.65, fontSize: 13 }}>
              Seen this session: <b>{s.seenNames.length}</b>
            </div>
          )}

          {s.suggestions && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 600 }}>Pick one:</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                {s.suggestions.map((name) => (
                  <button key={name} onClick={() => pickName(name)} style={choiceBtn()}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {s.step === 2 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ opacity: 0.85 }}>
            Chosen name: <b>{s.mafiaName}</b>
          </div>

          <Field label="City">
            <CityAutocomplete
              value={s.city}
              onChange={(v) => setS((p) => ({ ...p, city: v }))}
            />
          </Field>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setS((p) => ({ ...p, step: 1 }))} style={btn("secondary")}>
              Back
            </button>
            <button
              onClick={() => setS((p) => ({ ...p, step: 3 }))}
              disabled={s.city.trim().length === 0}
              style={btn("primary", s.city.trim().length === 0)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {s.step === 3 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ opacity: 0.85 }}>
            Name: <b>{s.mafiaName}</b> • City: <b>{s.city}</b>
          </div>

          <div style={{ opacity: 0.75, fontSize: 13 }}>Pick one or more:</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {TURTLES.map((t) => {
              const selected = s.turtles.includes(t);
              return (
                <button key={t} onClick={() => toggleTurtle(t)} style={tile(selected)}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{t}</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>{selected ? "Selected" : ""}</div>
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 13 }}>
                    {t === "Leonardo"
                      ? "Leader energy"
                      : t === "Michelangelo"
                      ? "Party energy"
                      : t === "Donatello"
                      ? "Builder energy"
                      : "Chaos energy"}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ opacity: 0.75 }}>
            Selected: <b>{s.turtles.length ? s.turtles.join(", ") : "(none)"}</b>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setS((p) => ({ ...p, step: 2 }))} style={btn("secondary")}>
              Back
            </button>
            <button
              onClick={() => setS((p) => ({ ...p, step: 4 }))}
              disabled={s.turtles.length === 0}
              style={btn("primary", s.turtles.length === 0)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {s.step === 4 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ opacity: 0.85 }}>
            Name: <b>{s.mafiaName}</b> • City: <b>{s.city}</b> • Turtles:{" "}
            <b>{s.turtles.length ? s.turtles.join(", ") : "(none)"}</b>
          </div>

          <div style={{ fontWeight: 700 }}>Choose crews:</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {CREWS.map((c) => {
              const checked = s.crews.includes(c.id);
              return (
                <label key={c.id} style={crewRow(checked)}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCrew(c.id)}
                    style={{ transform: "scale(1.1)" }}
                  />
                  <span style={{ fontWeight: 600 }}>{c.label}</span>
                </label>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setS((p) => ({ ...p, step: 3 }))} style={btn("secondary")}>
              Back
            </button>
            <button onClick={submitAll} disabled={s.submitting} style={btn("primary", s.submitting)}>
              {s.submitting ? "Saving…" : "Save to Google Sheet"}
            </button>
          </div>

          <div style={{ opacity: 0.7, fontSize: 13 }}>(Crews are optional; you can submit with none selected.)</div>
        </div>
      )}

      {s.step === 5 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={alert("success")}>
            Saved ✅ You’re officially <b>{s.mafiaName}</b>.
          </div>
          <div style={{ lineHeight: 1.6 }}>
            <div>
              <b>City:</b> {s.city}
            </div>
            <div>
              <b>Turtles:</b> {s.turtles.length ? s.turtles.join(", ") : "(none)"}
            </div>
            <div>
              <b>Crews:</b> {s.crews.length ? s.crews.join(", ") : "(none)"}
            </div>
            <div>
              <b>Movie:</b> {s.resolvedMovieTitle ?? s.mafiaMovieTitle}
            </div>
          </div>
          <button onClick={() => setS((p) => ({ ...p, step: 1 }))} style={btn("secondary")}>
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

function CityAutocomplete({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CityPrediction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = value.trim();
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

  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="Brooklyn, NY"
        style={input()}
        autoComplete="off"
      />
      {loading && (
        <div style={{ position: "absolute", right: 10, top: 10, opacity: 0.6, fontSize: 12 }}>
          …
        </div>
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
              onMouseDown={(e) => e.preventDefault()} // keeps focus
              onClick={() => {
                onChange(it.description);
                setOpen(false);
            }}

              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                background: "white",
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

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontWeight: 650 }}>{label}</span>
      {children}
    </label>
  );
}

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
    display: "grid",
    gap: 14,
  };
}

function input(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };
}

function btn(kind: "primary" | "secondary", disabled?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
  if (kind === "primary") return { ...base, background: "black", color: "white", borderColor: "black" };
  return { ...base, background: "white" };
}

function choiceBtn(): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "white",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 16,
  };
}

function tile(selected: boolean): React.CSSProperties {
  return {
    padding: 12,
    borderRadius: 12,
    border: selected ? "2px solid black" : "1px solid rgba(0,0,0,0.18)",
    background: selected ? "rgba(0,0,0,0.04)" : "white",
    textAlign: "left",
    cursor: "pointer",
  };
}

function crewRow(checked: boolean): React.CSSProperties {
  return {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    border: checked ? "2px solid black" : "1px solid rgba(0,0,0,0.18)",
    background: checked ? "rgba(0,0,0,0.04)" : "white",
    cursor: "pointer",
  };
}

function alert(kind: "error" | "success"): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: kind === "error" ? "rgba(255,0,0,0.06)" : "rgba(0,200,0,0.08)",
    fontWeight: 650,
  };
}
