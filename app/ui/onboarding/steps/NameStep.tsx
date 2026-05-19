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
  mediaType?: "movie" | "tv";
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
  mediaType,
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
    <div className="grid gap-3">
      {/* Keep existing mafia name option */}
      {showKeepExisting && (
        <div className="p-4 rounded-[--radius] border border-tomato/30 bg-tomato/10 text-center">
          <div className="mb-2 text-sm text-muted-foreground">Keep your current mafia name?</div>
          <button onClick={onKeepExisting} style={btn("accent")}>
            Keep &quot;{existingName}&quot; and continue
          </button>
        </div>
      )}

      {/* Keep Discord Nickname option */}
      {showKeepDiscord && (
        <div className="p-4 rounded-[--radius] border border-tomato/30 bg-tomato/10 text-center">
          <div className="mb-2 text-sm text-muted-foreground">Want to use your Discord nickname?</div>
          <button onClick={onKeepExisting} style={btn("accent")}>
            Keep &quot;{discordNick}&quot; and continue
          </button>
        </div>
      )}

      {(showKeepExisting || showKeepDiscord) && (
        <div className="text-center text-muted-foreground/80 text-sm">
          - or generate a new name instead -
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Favorite pizza topping">
          <input
            value={topping}
            onChange={(e) => onChange({ topping: e.target.value })}
            placeholder="Pepperoni"
            style={input()}
          />
        </Field>

        <Field label="Favorite mafia movie or TV show">
          <input
            value={mafiaMovieTitle}
            onChange={(e) => onChange({ mafiaMovieTitle: e.target.value })}
            placeholder="Goodfellas, The Sopranos..."
            style={input()}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2.5 items-center">
        <button
          onClick={() => onGenerate(false)}
          disabled={!canGenerate || submitting}
          style={btn("accent", !canGenerate || submitting)}
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
          <span className="text-muted-foreground text-sm">
            Matched: <b className="text-foreground">{resolvedMovieTitle}</b>{" "}
            {releaseDate ? `(${releaseDate.slice(0, 4)})` : ""}
            {mediaType === "tv" ? " - TV Show" : ""}
          </span>
        )}
      </div>

      {seenNames.length > 0 && (
        <div className="text-muted-foreground/80 text-xs">
          Seen this session: <b className="text-foreground">{seenNames.length}</b>
        </div>
      )}

      {(suggestions || submitting) && (
        <div className="grid gap-2.5">
          <div className="font-[family-name:var(--font-display)] text-lg font-bold flex items-center gap-2 text-foreground">
            Pick one:
            {submitting && (
              <span
                className="inline-block w-4 h-4 rounded-full border-2 border-rule"
                style={{
                  borderTopColor: "hsl(var(--tomato))",
                  animation: "spin 1s linear infinite",
                }}
              />
            )}
          </div>
          <div
            className="grid grid-cols-1 gap-2.5"
            style={{ opacity: submitting ? 0.5 : 1 }}
          >
            {suggestions?.map((name) => (
              <button key={name} onClick={() => onPickName(name)} disabled={submitting} style={choiceBtn()}>
                {name}
              </button>
            ))}
          </div>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      <div className="mt-3">
        <button onClick={onBack} style={btn("secondary")}>
          {isUpdate ? "Cancel" : "Back"}
        </button>
      </div>
    </div>
  );
}
