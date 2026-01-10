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
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ opacity: 0.75, fontSize: 13 }}>Pick one or more:</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {TURTLES.map((t) => {
          const selected = turtles.includes(t.id);
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
        Selected: <b>{turtles.length ? turtles.join(", ") : "(none)"}</b>
      </div>

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
