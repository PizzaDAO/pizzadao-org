// app/ui/onboarding/styles.ts
// Shared style functions for onboarding components

import type { CSSProperties } from "react";

export function card(): CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
    display: "grid",
    gap: 14,
    color: "#000000",
  };
}

export function input(): CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    background: "#ffffff",
    color: "#000000",
    appearance: "none",
  };
}

export function btn(kind: "primary" | "secondary", disabled?: boolean): CSSProperties {
  const base: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
  if (kind === "primary") return { ...base, background: "black", color: "white", borderColor: "black" };
  return { ...base, background: "white", color: "#000000" };
}

export function choiceBtn(): CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "white",
    color: "#000000",
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
    border: selected ? "2px solid black" : "1px solid rgba(0,0,0,0.18)",
    background: selected ? "rgba(0,0,0,0.04)" : "white",
    color: "#000000",
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
    border: checked ? "2px solid black" : "1px solid rgba(0,0,0,0.18)",
    background: checked ? "rgba(0,0,0,0.04)" : "white",
    color: "#000000",
    cursor: "pointer",
  };
}

export function alert(kind: "error" | "success" | "info"): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background:
      kind === "error"
        ? "rgba(255,0,0,0.06)"
        : kind === "success"
          ? "rgba(0,200,0,0.08)"
          : "rgba(0,0,255,0.05)",
    fontWeight: 650,
  };
}
