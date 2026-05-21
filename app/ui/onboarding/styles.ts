// app/ui/onboarding/styles.ts
// Shared style functions for onboarding components.
//
// truffle-11395 (Restyle Phase 2): these primitives now consume the new
// semantic HSL tokens (`--background`, `--foreground`, `--primary`, `--card`,
// `--rule`, `--tomato`, `--ring`, `--radius`) introduced in Phase 1.
// See plans/site-restyle-pizzadao-org.md.
//
// API kept stable: callers still receive `CSSProperties` from `card()`,
// `btn(kind)`, `input()`, `choiceBtn()`, `tile(selected)`, `crewRow(checked)`,
// and `alert(kind)`. A new `btn("accent")` variant ships the loud brand CTA.

import type { CSSProperties } from "react";

// Card: cream-tinted surface with subtle ink rule + soft shadow.
export function card(): CSSProperties {
  return {
    border: "1px solid hsl(var(--rule) / 0.12)",
    borderRadius: "var(--radius)",
    padding: 16,
    boxShadow: "0 8px 30px hsl(var(--ink) / 0.06)",
    background: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    display: "grid",
    gap: 14,
  };
}

// Inputs: background tone, ink-soft border, tomato focus ring (via :focus
// styles in consuming components if needed). Inline style can't easily
// express :focus, so consumers wanting a ring should add the focus class
// `focus:ring-2 focus:ring-[hsl(var(--ring))]` themselves.
export function input(): CSSProperties {
  return {
    width: "100%",
    minHeight: 44, // sicilian-41551: mobile touch-target floor
    padding: "10px 12px",
    borderRadius: "var(--radius)",
    border: "1px solid hsl(var(--rule) / 0.22)",
    // sicilian-41551: 16px prevents iOS Safari zoom-on-focus
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    appearance: "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
  };
}

// Buttons: three variants now.
//   primary   — ink-on-cream (or cream-on-ink in dark), the default UI button
//   secondary — neutral outline, low-emphasis
//   accent    — tomato CTA, loud brand action (Phase 2 addition)
export function btn(
  kind: "primary" | "secondary" | "accent",
  disabled?: boolean,
): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44, // sicilian-41551: mobile touch-target floor (WCAG 2.5.5)
    padding: "10px 14px",
    borderRadius: "var(--radius)",
    border: "1px solid transparent",
    fontWeight: 600,
    fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
  };
  if (kind === "primary") {
    return {
      ...base,
      background: "hsl(var(--primary))",
      color: "hsl(var(--primary-foreground))",
      borderColor: "hsl(var(--primary))",
    };
  }
  if (kind === "accent") {
    return {
      ...base,
      background: "hsl(var(--tomato))",
      color: "hsl(var(--cream))",
      borderColor: "hsl(var(--tomato))",
    };
  }
  // secondary
  return {
    ...base,
    background: "hsl(var(--secondary))",
    color: "hsl(var(--secondary-foreground))",
    borderColor: "hsl(var(--rule) / 0.22)",
  };
}

export function choiceBtn(): CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: "var(--radius)",
    border: "1px solid hsl(var(--rule) / 0.22)",
    background: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 16,
    transition: "background-color 150ms ease, border-color 150ms ease",
  };
}

export function tile(selected: boolean): CSSProperties {
  return {
    padding: 12,
    borderRadius: "var(--radius)",
    border: selected
      ? "2px solid hsl(var(--tomato))"
      : "1px solid hsl(var(--rule) / 0.22)",
    background: selected ? "hsl(var(--tomato) / 0.08)" : "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    textAlign: "left",
    cursor: "pointer",
    transition: "background-color 150ms ease, border-color 150ms ease",
  };
}

export function crewRow(checked: boolean): CSSProperties {
  return {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: 10,
    borderRadius: "var(--radius)",
    border: checked
      ? "2px solid hsl(var(--tomato))"
      : "1px solid hsl(var(--rule) / 0.22)",
    background: checked ? "hsl(var(--tomato) / 0.08)" : "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    cursor: "pointer",
    transition: "background-color 150ms ease, border-color 150ms ease",
  };
}

// Alerts:
//   error  — destructive tomato wash with destructive border
//   info   — muted neutral
//   success — emerald (no design token for success on pizzadao.org; keep emerald)
export function alert(kind: "error" | "success" | "info"): CSSProperties {
  const base: CSSProperties = {
    padding: "10px 12px",
    borderRadius: "var(--radius)",
    fontWeight: 600,
  };
  if (kind === "error") {
    return {
      ...base,
      background: "hsl(var(--destructive) / 0.10)",
      color: "hsl(var(--destructive))",
      border: "1px solid hsl(var(--destructive) / 0.30)",
    };
  }
  if (kind === "success") {
    return {
      ...base,
      background: "rgba(16, 185, 129, 0.10)", // emerald-500
      color: "rgb(4, 120, 87)",                // emerald-700
      border: "1px solid rgba(16, 185, 129, 0.30)",
    };
  }
  // info / neutral
  return {
    ...base,
    background: "hsl(var(--muted))",
    color: "hsl(var(--foreground))",
    border: "1px solid hsl(var(--rule) / 0.22)",
  };
}
