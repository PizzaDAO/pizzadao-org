// app/ui/OnboardingWizard.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  step: 1 | 2 | 3 | 4 | 5; // keep 5 for backward-compat saved state, but we won't use it
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

  // ✅ multi-select turtles (stores TURTLES[*].id)
  turtles: string[];

  crews: string[];

  seenNames: string[];

  // ✅ Discord linking (Phase 3)
  discordId?: string;
  discordJoined?: boolean;

  submitting: boolean;
  error?: string;
  success?: boolean;
};

type CrewOption = {
  id: string;
  label: string; // Crew name
  turtles?: string[] | string; // from sheet: comma-delimited turtle names
  role?: string;
  channel?: string;
  event?: string;
  emoji?: string;
  sheet?: string;
  callTime?: string;
  callLength?: string;
  tasks?: { label: string; url?: string }[];
};

type CrewMappingsResponse = {
  crews: CrewOption[];
};

function uuidLike() {
  return `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

// bump key to avoid old saved state shape conflicts (turtle -> turtles)
const LS_KEY = "mob_pizza_onboarding_v3";
const PENDING_CLAIM_KEY = "mob_pizza_onboarding_pending_claim_v1";

function norm(s: unknown) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}
function normKey(s: unknown) {
  return norm(s).toLowerCase();
}
function splitTurtlesCell(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(norm).filter(Boolean);
  const s = norm(v);
  if (!s) return [];
  return s
    .split(/[,/|]+/)
    .map((x) => norm(x))
    .filter(Boolean);
}

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
    discordId: undefined,
    discordJoined: false,
    submitting: false,
  }));

  // ✅ dynamic crews from Crew Mappings sheet (fallback to constants)
  const [crewOptions, setCrewOptions] = useState<CrewOption[]>(() =>
    (CREWS ?? []).map((c: any) => ({
      id: String(c.id),
      label: String(c.label ?? c.id),
      turtles: [],
    }))
  );
  const [crewsLoading, setCrewsLoading] = useState(false);

  // ✅ Pick up Discord callback params (/?discordId=...&discordJoined=1&sessionId=...)
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const discordId = url.searchParams.get("discordId");
      const joined = url.searchParams.get("discordJoined");
      const returnedSessionId = url.searchParams.get("sessionId");

      if (discordId) {
        setS((p) => ({
          ...p,
          discordId,
          discordJoined: joined === "1" || joined === "true",
          sessionId: returnedSessionId || p.sessionId,
        }));

        // clean URL
        url.searchParams.delete("discordId");
        url.searchParams.delete("discordJoined");
        url.searchParams.delete("sessionId");
        window.history.replaceState({}, "", url.toString());
      }
    } catch { }
  }, []);

  // ✅ Fetch crew mappings
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setCrewsLoading(true);
        const res = await fetch("/api/crew-mappings", { cache: "no-store" });
        const data = (await res.json()) as CrewMappingsResponse | any;
        if (!res.ok) throw new Error(data?.error || "Failed to load crews");

        const crews: CrewOption[] = Array.isArray(data?.crews) ? data.crews : [];
        const cleaned = crews
          .map((c) => ({
            ...c,
            id: String((c as any)?.id ?? ""),
            label: norm((c as any)?.label ?? ""),
            turtles: splitTurtlesCell((c as any)?.turtles),
            emoji: norm((c as any)?.emoji) || undefined,
            role: norm((c as any)?.role) || undefined,
            channel: norm((c as any)?.channel) || undefined,
            event: norm((c as any)?.event) || undefined,
            sheet: norm((c as any)?.sheet) || undefined,
            callTime: norm((c as any)?.callTime) || undefined,
            callLength: norm((c as any)?.callLength) || undefined,
            tasks: Array.isArray((c as any)?.tasks) ? (c as any).tasks : [],
          }))
          .filter((c) => c.id && c.label);

        if (!alive) return;
        if (cleaned.length) setCrewOptions(cleaned);
      } catch {
        // keep fallback crews
      } finally {
        if (alive) setCrewsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
          // if a saved state is on step 5, bring them to step 4 (combined)
          step: parsed?.step === 5 ? 4 : (parsed?.step ?? prev.step),
          turtles: migratedTurtles,
          submitting: false,
          error: undefined,
          success: false,
          seenNames: Array.isArray(parsed?.seenNames) ? parsed.seenNames : [],
          discordId: typeof parsed?.discordId === "string" ? parsed.discordId : prev.discordId,
          discordJoined: typeof parsed?.discordJoined === "boolean" ? parsed.discordJoined : prev.discordJoined,
        }));
      }
    } catch { }
  }, []);

  // Persist draft
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ ...s, submitting: false, error: undefined, success: false })
      );
    } catch { }
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
    s.discordId,
    s.discordJoined,
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

          // ✅ Discord (include in payload so backend can embed in RawJSON)
          discordId: s.discordId || "",
          discordJoined: !!s.discordJoined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Submit failed");

      // clear the pending claim flag if it existed
      try {
        localStorage.removeItem(PENDING_CLAIM_KEY);
      } catch { }

      setS((p) => ({ ...p, submitting: false, success: true, error: undefined, step: 4 }));
    } catch (e: any) {
      setS((p) => ({
        ...p,
        submitting: false,
        error: e?.message || "Submit failed",
        success: false,
      }));
    }
  }

  function connectDiscord() {
    window.location.href = `/api/discord/login?state=${encodeURIComponent(s.sessionId)}`;
  }

  async function claimRoles() {
    // If we don't have a discordId yet, start OAuth and auto-finish when we come back.
    if (!s.discordId) {
      try {
        localStorage.setItem(PENDING_CLAIM_KEY, "1");
      } catch { }
      connectDiscord();
      return;
    }

    // Already linked, just save/claim now.
    submitAll();
  }

  // If user just returned from Discord and they intended to claim roles, auto-submit.
  useEffect(() => {
    if (!s.discordId) return;

    let pending = false;
    try {
      pending = localStorage.getItem(PENDING_CLAIM_KEY) === "1";
    } catch { }

    if (pending && !s.submitting && !s.success) {
      submitAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.discordId]);

  const stepTitle = useMemo(() => {
    switch (s.step) {
      case 1:
        return "1) Pick your mafia name";
      case 2:
        return "2) Your city";
      case 3:
        return "3) What kind of team member are you?";
      case 4:
      case 5:
        return "4) Choose Crews:";
    }
  }, [s.step]);

  // ✅ Map turtle ids -> labels so we can match sheet values like "Leonardo"
  const turtleIdToLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of TURTLES as any[]) {
      if (!t) continue;
      const id = String(t.id ?? "").trim();
      const label = String(t.label ?? "").trim();
      if (id) m[id] = label || id;
    }
    return m;
  }, []);

  // ✅ RECOMMENDATION:
  // Crew is “Recommended” if ANY selected turtle matches ANY turtle in that crew row's "Turtles" column.
  // Now returns a Map<CrewID, MatchedTurtleID[]> so we can show WHY it's recommended.
  const recommendedCrewReasons = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!s.turtles.length) return map;

    // Build a quick lookup for selected turtles: id -> id (normalized)
    // We want to preserve the ORIGINAL selected ID (s.turtles elements) to display their images later.
    const selectedTurtles = s.turtles; // these are IDs like "Leonardo"

    for (const c of crewOptions) {
      const crewIdStr = String(c.id);
      const crewTurtlesNormalized = new Set(
        splitTurtlesCell((c as any)?.turtles).map(normKey)
      );

      const matches: string[] = [];

      for (const tId of selectedTurtles) {
        // We match if the turtle ID itself or its label matches one of the crew's turtle entries
        const tIdKey = normKey(tId);
        const tLabelKey = normKey(turtleIdToLabel[tId]);

        if (crewTurtlesNormalized.has(tIdKey) || crewTurtlesNormalized.has(tLabelKey)) {
          matches.push(tId);
        }
      }

      if (matches.length > 0) {
        map.set(crewIdStr, matches);
      }
    }
    return map;
  }, [s.turtles, crewOptions, turtleIdToLabel]);

  return (
    <div style={card()}>
      {/* Consolidated Selection Summary */}
      {(s.mafiaName || s.city || s.turtles.length > 0) && (
        <div style={{ opacity: 0.9, fontSize: 16, borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: 8, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {s.mafiaName && <span>Name: <b>{s.mafiaName}</b></span>}
          {s.city && <span> • City: <b>{s.city}</b></span>}
          {s.turtles.length > 0 && <span> • Roles: <b>{s.turtles.join(", ")}</b></span>}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontWeight: 800 }}>{stepTitle}</h2>
        <button
          onClick={() => {
            try {
              localStorage.removeItem(LS_KEY);
              localStorage.removeItem(PENDING_CLAIM_KEY);
            } catch { }
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
              discordId: undefined,
              discordJoined: false,
              submitting: false,
            });
          }}
          style={btn("secondary")}
        >
          Reset
        </button>
      </div>

      {s.error && <div style={alert("error")}>{s.error}</div>}


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
                Matched: <b>{s.resolvedMovieTitle}</b> {s.releaseDate ? `(${s.releaseDate.slice(0, 4)})` : ""}
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


          <Field label="City">
            <CityAutocomplete value={s.city} onChange={(v) => setS((p) => ({ ...p, city: v }))} />
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


          <div style={{ opacity: 0.75, fontSize: 13 }}>Pick one or more:</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {TURTLES.map((t) => {
              const selected = s.turtles.includes(t.id);
              return (
                <button key={t.id} onClick={() => toggleTurtle(t.id)} style={tile(selected)}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <img src={t.image} alt={t.label} style={{ width: 40, height: 40, objectFit: "contain" }} />

                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800 }}>{t.label}</div>
                      <div style={{ opacity: 0.7, fontSize: 13 }}>{t.role}</div>
                    </div>

                    {selected && <div style={{ fontSize: 12, opacity: 0.7 }}>Selected</div>}
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

      {(s.step === 4 || s.step === 5) && (
        <div style={{ display: "grid", gap: 12 }}>


          {crewsLoading && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <div style={{ opacity: 0.65, fontSize: 13 }}>Loading crews…</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {crewOptions.map((c) => {
              const idStr = String(c.id);
              const checked = s.crews.includes(idStr);
              const recommended = recommendedCrewReasons.get(idStr);

              return (
                <label key={idStr} style={crewRow(checked)}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCrew(idStr)}
                    style={{ transform: "scale(1.1)" }}
                  />

                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700 }}>
                        {c.emoji ? `${c.emoji} ` : ""}
                        {c.label}
                      </span>

                      {recommended && recommended.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 8px",
                            borderRadius: 999,
                            border: "1px solid rgba(0,0,0,0.18)",
                            background: "rgba(0,0,0,0.04)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center" }}>
                            {recommended.map((tId, idx) => {
                              const img = TURTLES.find((t) => t.id === tId)?.image;
                              if (!img) return null;
                              return (
                                <img
                                  key={tId}
                                  src={img}
                                  alt={tId}
                                  style={{
                                    width: 16.8,
                                    height: 16.8,
                                    marginLeft: idx === 0 ? 0 : -4,
                                    objectFit: "contain",
                                    flexShrink: 0,
                                  }}
                                />
                              );
                            })}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 750 }}>Recommended</span>
                        </div>
                      )}
                    </div>

                    {(c.callTime || c.callLength) && (
                      <div style={{ opacity: 0.7, fontSize: 13 }}>
                        {c.callTime ? c.callTime : ""}
                        {c.callTime && c.callLength ? " • " : ""}
                        {c.callLength ? c.callLength : ""}
                      </div>
                    )}

                    {c.tasks && c.tasks.length > 0 && (
                      <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}>Current Tasks</div>
                        {c.tasks.map((t, idx) => (
                          <div key={idx} style={{ fontSize: 12, opacity: 0.85, display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                            <span style={{ flexShrink: 0 }}>•</span>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.url ? (
                                <a
                                  href={t.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: "2px" }}
                                >
                                  {t.label}
                                </a>
                              ) : (
                                <span>{t.label}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {c.sheet && (
                      <a
                        href={c.sheet}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: 13,
                          fontWeight: 650,
                          opacity: 0.85,
                          textDecoration: "none",
                        }}
                        title={c.sheet}
                      >
                        Open crew sheet ↗
                      </a>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          {/* ✅ Combined final action */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setS((p) => ({ ...p, step: 3 }))} style={btn("secondary")}>
                Back
              </button>
              <button onClick={claimRoles} disabled={s.submitting} style={btn("primary", s.submitting)}>
                {s.submitting ? "Claiming…" : "Claim Discord Roles"}
              </button>
            </div>


          </div>

          {s.success && (
            <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
              <div style={alert("success")}>
                Done ✅ You’re officially <b>{s.mafiaName}</b>.
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
                {s.discordId && (
                  <div>
                    <b>Discord:</b> {s.discordJoined ? "Joined ✅" : "Linked ✅"} •{" "}
                    <span style={{ fontFamily: "monospace" }}>{s.discordId}</span>
                  </div>
                )}
              </div>


            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CityAutocomplete({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CityPrediction[]>([]);
  const [loading, setLoading] = useState(false);

  // ✅ If the user picked an item, we don't want the effect to re-open for that exact value.
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
        <div style={{ position: "absolute", right: 10, top: 10, opacity: 0.6, fontSize: 12 }}>…</div>
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
                suppressForValueRef.current = it.description; // ✅ prevent re-open on this selection
                onChange(it.description);
                setOpen(false);
                setItems([]); // ✅ nothing to show even if focused
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
