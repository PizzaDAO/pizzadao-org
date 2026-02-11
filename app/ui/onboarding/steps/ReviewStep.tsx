// app/ui/onboarding/steps/ReviewStep.tsx
"use client";

import { btn } from "../styles";
import type { CrewOption } from "../types";

type Props = {
  // New values (entered by user)
  mafiaName?: string;
  city: string;
  turtles: string[];
  crews: string[];

  // Existing values (from sheet)
  existingData?: {
    mafiaName?: string;
    city?: string;
    turtles: string[];
    crews: string[];
  };

  // For crew label lookup
  crewOptions: CrewOption[];

  // State
  submitting: boolean;

  // Callbacks
  onSubmit: () => void;
  onCancel: () => void;
};

export function ReviewStep({
  mafiaName,
  city,
  turtles,
  crews,
  existingData,
  crewOptions,
  submitting,
  onSubmit,
  onCancel,
}: Props) {
  const rows = [
    { label: "Name", new: mafiaName, old: existingData?.mafiaName },
    { label: "City", new: city, old: existingData?.city },
    { label: "Roles", new: turtles.join(", "), old: (existingData?.turtles ?? []).join(", ") },
    {
      label: "Crews",
      new: crews.map((id) => crewOptions.find((c) => c.id === id)?.label || id).join(", "),
      old: (existingData?.crews ?? []).join(", "),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gap: 0,
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "100px 1fr 1fr",
            gap: 10,
            background: "rgba(0,0,0,0.06)",
            padding: "12px 16px",
            fontWeight: 750,
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          <div>Field</div>
          <div>New (Entered)</div>
          <div>Existing (In Sheet)</div>
        </div>

        {rows.map((row, i) => {
          const hasChange =
            String(row.new || "")
              .trim()
              .toLowerCase() !==
            String(row.old || "")
              .trim()
              .toLowerCase();
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "100px 1fr 1fr",
                gap: 10,
                padding: "12px 16px",
                background: i % 2 === 1 ? "rgba(0,0,0,0.01)" : "white",
                borderTop: "1px solid rgba(0,0,0,0.05)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: "rgba(0,0,0,0.5)" }}>{row.label}</div>
              <div
                style={{
                  fontWeight: hasChange ? 750 : 400,
                  color: hasChange ? "#000" : "#777",
                  fontSize: 14,
                }}
              >
                {row.new || "-"}
                {hasChange && (
                  <span style={{ marginLeft: 6, color: "#10b981", fontSize: 16 }} title="Modified">
                    *
                  </span>
                )}
              </div>
              <div style={{ opacity: 0.6, fontSize: 14 }}>{row.old || "-"}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
        <button
          onClick={onSubmit}
          disabled={submitting}
          style={{ ...btn("primary", submitting), flex: 1 }}
        >
          {submitting ? "Updating Profile..." : "Yes, Update My Profile"}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{ ...btn("secondary"), flex: 1 }}
        >
          Don't Update
        </button>
      </div>
    </div>
  );
}
