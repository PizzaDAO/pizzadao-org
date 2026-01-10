// app/ui/onboarding/steps/NameStep.tsx
"use client";

import { btn, input, choiceBtn } from "../styles";
import { Field } from "../Field";
import type { NamegenResponse } from "../types";

type Props = {
  // Form data
  topping: string;
  mafiaMovieTitle: string;
  style: "balanced" | "serious" | "goofy";
  suggestions?: string[];
  resolvedMovieTitle?: string;
  releaseDate?: string;
  seenNames: string[];
  mafiaName?: string;

  // For keep-name options
  isUpdate?: boolean;
  existingName?: string;
  discordNick?: string;

  // State
  submitting: boolean;

  // Callbacks
  onChange: (updates: {
    topping?: string;
    mafiaMovieTitle?: string;
    style?: "balanced" | "serious" | "goofy";
  }) => void;
  onGenerate: (force: boolean) => void;
  onPickName: (name: string) => void;
  onKeepExisting: () => void;
  onBack: () => void;
};

export function NameStep({
  topping,
  mafiaMovieTitle,
  style,
  suggestions,
  resolvedMovieTitle,
  releaseDate,
  seenNames,
  mafiaName,
  isUpdate,
  existingName,
  discordNick,
  submitting,
  onChange,
  onGenerate,
  onPickName,
  onKeepExisting,
  onBack,
}: Props) {
  const canGenerate = topping.trim().length > 0 && mafiaMovieTitle.trim().length > 0;

  // Show keep existing name option in edit mode
  const showKeepExisting = isUpdate && existingName;

  // Show keep Discord nickname option for new users
  const showKeepDiscord = !isUpdate && discordNick && (mafiaName === discordNick || !mafiaName);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Keep existing mafia name option */}
      {showKeepExisting && (
        <div
          style={{
            padding: 16,
            background: "rgba(76, 175, 80, 0.1)",
            borderRadius: 12,
            border: "2px solid rgba(76, 175, 80, 0.3)",
            textAlign: "center",
          }}
        >
          <div style={{ marginBottom: 8, fontSize: 14, opacity: 0.8 }}>Keep your current mafia name?</div>
          <button
            onClick={onKeepExisting}
            style={{ ...btn("primary"), background: "#4CAF50" }}
          >
            Keep "{existingName}" and continue
          </button>
        </div>
      )}

      {/* Keep Discord Nickname option */}
      {showKeepDiscord && (
        <div
          style={{
            padding: 16,
            background: "rgba(76, 175, 80, 0.1)",
            borderRadius: 12,
            border: "2px solid rgba(76, 175, 80, 0.3)",
            textAlign: "center",
          }}
        >
          <div style={{ marginBottom: 8, fontSize: 14, opacity: 0.8 }}>Want to use your Discord nickname?</div>
          <button
            onClick={onKeepExisting}
            style={{ ...btn("primary"), background: "#4CAF50" }}
          >
            Keep "{discordNick}" and continue
          </button>
        </div>
      )}

      {(showKeepExisting || showKeepDiscord) && (
        <div style={{ textAlign: "center", opacity: 0.6, fontSize: 13 }}>
          - or generate a new name instead -
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Favorite pizza topping">
          <input
            value={topping}
            onChange={(e) => onChange({ topping: e.target.value })}
            placeholder="Pepperoni"
            style={input()}
          />
        </Field>

        <Field label="Favorite mafia movie">
          <input
            value={mafiaMovieTitle}
            onChange={(e) => onChange({ mafiaMovieTitle: e.target.value })}
            placeholder="Goodfellas"
            style={input()}
          />
        </Field>
      </div>

      <Field label="Vibe">
        <select
          value={style}
          onChange={(e) => onChange({ style: e.target.value as "balanced" | "serious" | "goofy" })}
          style={input()}
        >
          <option value="balanced">Balanced</option>
          <option value="serious">Serious</option>
          <option value="goofy">Goofy</option>
        </select>
      </Field>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => onGenerate(false)}
          disabled={!canGenerate || submitting}
          style={btn("primary", !canGenerate || submitting)}
        >
          {submitting ? "Generating..." : "Generate 3 names"}
        </button>

        {suggestions && (
          <button
            onClick={() => onGenerate(true)}
            disabled={!canGenerate || submitting}
            style={btn("secondary", !canGenerate || submitting)}
            title="Regenerate (won't repeat anything you've already seen)"
          >
            {submitting ? "Regenerating..." : "Regenerate"}
          </button>
        )}

        {resolvedMovieTitle && (
          <span style={{ opacity: 0.75 }}>
            Matched: <b>{resolvedMovieTitle}</b> {releaseDate ? `(${releaseDate.slice(0, 4)})` : ""}
          </span>
        )}
      </div>

      {seenNames.length > 0 && (
        <div style={{ opacity: 0.65, fontSize: 13 }}>
          Seen this session: <b>{seenNames.length}</b>
        </div>
      )}

      {suggestions && (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 600 }}>Pick one:</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            {suggestions.map((name) => (
              <button key={name} onClick={() => onPickName(name)} style={choiceBtn()}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button onClick={onBack} style={btn("secondary")}>
          {isUpdate ? "Cancel" : "Back"}
        </button>
      </div>
    </div>
  );
}
