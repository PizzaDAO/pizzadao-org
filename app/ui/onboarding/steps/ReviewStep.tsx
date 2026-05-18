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
    <div className="grid gap-4">
      <div className="grid border border-rule rounded-[--radius] overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[100px_1fr_1fr] gap-2.5 px-4 py-3 bg-secondary font-[family-name:var(--font-display)] font-bold text-xs uppercase tracking-wider text-foreground">
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
              className={`grid grid-cols-[100px_1fr_1fr] gap-2.5 px-4 py-3 border-t border-rule ${
                i % 2 === 1 ? "bg-secondary/40" : "bg-card"
              }`}
            >
              <div className="font-semibold text-sm text-muted-foreground">{row.label}</div>
              <div
                className={`text-sm ${
                  hasChange ? "font-bold text-foreground" : "text-muted-foreground"
                }`}
              >
                {row.new || "-"}
                {hasChange && (
                  <span className="ml-1.5 text-tomato text-base" title="Modified">
                    *
                  </span>
                )}
              </div>
              <div className="text-muted-foreground text-sm">{row.old || "-"}</div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 mt-2">
        <button
          onClick={onSubmit}
          disabled={submitting}
          style={{ ...btn("accent", submitting), flex: 1 }}
        >
          {submitting ? "Updating Profile..." : "Yes, Update My Profile"}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{ ...btn("secondary"), flex: 1 }}
        >
          Don&apos;t Update
        </button>
      </div>
    </div>
  );
}
