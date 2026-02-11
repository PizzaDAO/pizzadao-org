// app/ui/onboarding/styles.ts
// Shared style functions for onboarding components

import type { CSSProperties } from "react";

export function card(): CSSProperties {
  return {
    border: "1px solid var(--color-border)",
    borderRadius: 14,
    padding: 16,
    boxShadow: "var(--shadow-card)",
    background: "var(--color-surface)",
    display: "grid",
    gap: 14,
    color: "var(--color-text)",
  };
}

export function input(): CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--color-input-border)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    background: "var(--color-input-bg)",
    color: "var(--color-input-text)",
    appearance: "none",
  };
}

export function btn(kind: "primary" | "secondary", disabled?: boolean): CSSProperties {
  const base: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--color-border-strong)",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
  if (kind === "primary") return { ...base, background: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)", borderColor: "var(--color-btn-primary-border)" };
  return { ...base, background: "var(--color-btn-secondary-bg)", color: "var(--color-btn-secondary-text)" };
}

export function choiceBtn(): CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--color-border-strong)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 16,
  };
}

export function tile(selected: boolean): CSSProperties {
  return {
    padding: 12,
    borderRadius: 12,
    border: selected ? "2px solid var(--color-btn-primary-bg)" : "1px solid var(--color-border-strong)",
    background: selected ? "var(--color-surface-hover)" : "var(--color-surface)",
    color: "var(--color-text)",
    textAlign: "left",
    cursor: "pointer",
  };
}

export function crewRow(checked: boolean): CSSProperties {
  return {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    border: checked ? "2px solid var(--color-btn-primary-bg)" : "1px solid var(--color-border-strong)",
    background: checked ? "var(--color-surface-hover)" : "var(--color-surface)",
    color: "var(--color-text)",
    cursor: "pointer",
  };
}

export function alert(kind: "error" | "success" | "info"): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--color-border)",
    background:
      kind === "error"
        ? "rgba(255,0,0,0.06)"
        : kind === "success"
          ? "rgba(0,200,0,0.08)"
          : "rgba(0,0,255,0.05)",
    fontWeight: 650,
  };
}
