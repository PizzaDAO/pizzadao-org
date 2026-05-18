// app/ui/onboarding/steps/RolesStep.tsx
"use client";

import { TURTLES } from "../../constants";
import { btn, tile } from "../styles";

type Props = {
  turtles: string[];
  onChange: (turtles: string[]) => void;
  onNext: () => void;
  onBack: () => void;
  isUpdate?: boolean;
};

export function RolesStep({ turtles, onChange, onNext, onBack, isUpdate }: Props) {
  const canProceed = turtles.length > 0;

  function toggleTurtle(id: string) {
    const has = turtles.includes(id);
    onChange(has ? turtles.filter((x) => x !== id) : [...turtles, id]);
  }

  return (
    <div className="grid gap-3">
      <div className="text-sm text-muted-foreground">Pick one or more:</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {TURTLES.map((t) => {
          const selected = turtles.includes(t.id);
          return (
            <button key={t.id} onClick={() => toggleTurtle(t.id)} style={tile(selected)}>
              <div className="flex gap-3 items-center">
                <img src={t.image} alt={t.label} className="w-10 h-10 object-contain" />

                <div className="flex-1 text-left">
                  <div className="font-[family-name:var(--font-display)] font-extrabold text-foreground">
                    {t.label}
                  </div>
                  <div className="text-muted-foreground text-xs">{t.role}</div>
                </div>

                {selected && (
                  <div className="text-xs font-semibold text-tomato">Selected</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-muted-foreground text-sm">
        Selected: <b className="text-foreground">{turtles.length ? turtles.join(", ") : "(none)"}</b>
      </div>

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
