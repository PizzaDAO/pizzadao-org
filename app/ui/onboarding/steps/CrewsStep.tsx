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
    <div className="grid gap-3">
      {crewsLoading && (
        <div className="flex justify-end mb-1">
          <div className="text-xs text-muted-foreground/80">Loading crews...</div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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

              <div className="grid gap-1">
                <div className="flex gap-2 items-baseline flex-wrap">
                  <span className="font-[family-name:var(--font-display)] font-bold text-foreground">
                    {c.emoji ? `${c.emoji} ` : ""}
                    {c.label}
                  </span>

                  {recommended && recommended.length > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-tomato/30 bg-tomato/10">
                      <div className="flex items-center">
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
                      <span className="text-xs font-bold text-tomato">Recommended</span>
                    </div>
                  )}
                </div>

                {(c.callTime || c.callLength) && (
                  <div className="text-xs text-muted-foreground">
                    {c.callTime ? c.callTime : ""}
                    {c.callTime && c.callLength ? " - " : ""}
                    {c.callLength ? c.callLength : ""}
                  </div>
                )}

                {c.tasks && c.tasks.length > 0 && (
                  <div className="mt-1.5 grid gap-0.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                      Top Tasks
                    </div>
                    {c.tasks.map((t, idx) => (
                      <div key={idx} className="text-xs text-foreground/85 flex items-baseline gap-1 min-w-0">
                        <span className="shrink-0">-</span>
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap">
                          {t.url ? (
                            <a
                              href={t.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-inherit underline underline-offset-2"
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
                    className="text-xs font-semibold text-foreground/85 no-underline hover:text-tomato"
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

      <div className="grid gap-1.5">
        <div className="flex gap-2.5">
          <button onClick={onBack} style={btn("secondary")}>
            Back
          </button>
          <button onClick={onSubmit} disabled={submitting} style={btn("accent", submitting)}>
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
        <div className="grid gap-2.5 mt-1.5">
          <div style={alert("success")}>
            Done! You&apos;re officially <b>{successData.mafiaName}</b>.
          </div>

          <div className="leading-relaxed text-sm">
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
                <span className="font-mono">{successData.discordId}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
