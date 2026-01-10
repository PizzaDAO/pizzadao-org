// app/ui/onboarding/steps/CrewsStep.tsx
"use client";

import { useMemo } from "react";
import { TURTLES } from "../../constants";
import { btn, crewRow, alert } from "../styles";
import type { CrewOption, WizardData } from "../types";
import { normKey, splitTurtlesCell } from "../types";

type Props = {
  crews: string[];
  turtles: string[];
  crewOptions: CrewOption[];
  crewsLoading: boolean;
  onChange: (crews: string[]) => void;
  onSubmit: () => void;
  onBack: () => void;
  isUpdate?: boolean;
  submitting?: boolean;
  success?: boolean;
  successData?: {
    mafiaName?: string;
    city: string;
    turtles: string[];
    crews: string[];
    resolvedMovieTitle?: string;
    mafiaMovieTitle: string;
    discordId?: string;
    discordJoined?: boolean;
  };
};

export function CrewsStep({
  crews,
  turtles,
  crewOptions,
  crewsLoading,
  onChange,
  onSubmit,
  onBack,
  isUpdate,
  submitting,
  success,
  successData,
}: Props) {
  // Map turtle ids -> labels for matching
  const turtleIdToLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of TURTLES as unknown as any[]) {
      if (!t) continue;
      const id = String(t.id ?? "").trim();
      const label = String(t.label ?? "").trim();
      if (id) m[id] = label || id;
    }
    return m;
  }, []);

  // Crew recommendation logic
  const recommendedCrewReasons = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!turtles.length) return map;

    for (const c of crewOptions) {
      const crewIdStr = String(c.id);
      const crewTurtlesNormalized = new Set(
        splitTurtlesCell((c as any)?.turtles).map(normKey)
      );

      const matches: string[] = [];
      for (const tId of turtles) {
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
  }, [turtles, crewOptions, turtleIdToLabel]);

  function toggleCrew(id: string) {
    const has = crews.includes(id);
    onChange(has ? crews.filter((x) => x !== id) : [...crews, id]);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {crewsLoading && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <div style={{ opacity: 0.65, fontSize: 13 }}>Loading crews...</div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {crewOptions.map((c) => {
          const idStr = String(c.id);
          const checked = crews.includes(idStr);
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
                    {c.callTime && c.callLength ? " - " : ""}
                    {c.callLength ? c.callLength : ""}
                  </div>
                )}

                {c.tasks && c.tasks.length > 0 && (
                  <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        opacity: 0.6,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Top Tasks
                    </div>
                    {c.tasks.map((t, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: 12,
                          opacity: 0.85,
                          display: "flex",
                          alignItems: "baseline",
                          gap: 4,
                          minWidth: 0,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>-</span>
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
                    Open crew sheet
                  </a>
                )}
              </div>
            </label>
          );
        })}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onBack} style={btn("secondary")}>
            Back
          </button>
          <button onClick={onSubmit} disabled={submitting} style={btn("primary", submitting)}>
            {submitting
              ? isUpdate
                ? "Updating..."
                : "Claiming..."
              : isUpdate
                ? "Update Profile"
                : "Claim Discord Roles"}
          </button>
        </div>
      </div>

      {success && successData && (
        <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
          <div style={alert("success")}>
            Done! You're officially <b>{successData.mafiaName}</b>.
          </div>

          <div style={{ lineHeight: 1.6 }}>
            <div>
              <b>City:</b> {successData.city}
            </div>
            <div>
              <b>Turtles:</b> {successData.turtles.length ? successData.turtles.join(", ") : "(none)"}
            </div>
            <div>
              <b>Crews:</b>{" "}
              {successData.crews.length
                ? successData.crews
                    .map((id) => {
                      const label = crewOptions.find((c) => c.id === id)?.label || id;
                      return label
                        .split(" ")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                        .join(" ");
                    })
                    .join(", ")
                : "(none)"}
            </div>
            <div>
              <b>Movie:</b> {successData.resolvedMovieTitle ?? successData.mafiaMovieTitle}
            </div>
            {successData.discordId && (
              <div>
                <b>Discord:</b> {successData.discordJoined ? "Joined" : "Linked"} -{" "}
                <span style={{ fontFamily: "monospace" }}>{successData.discordId}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
