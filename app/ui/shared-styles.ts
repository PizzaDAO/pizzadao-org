// app/ui/shared-styles.ts
// App-wide shared primitive styles (cards, buttons, inputs, overlays).
//
// truffle-11395 (Restyle Phase 2): now consumes the new semantic HSL tokens
// (`--background`, `--foreground`, `--primary`, `--card`, `--rule`, `--tomato`,
// `--ring`, `--radius`) introduced in Phase 1 instead of the legacy
// `--color-*` aliases. See plans/site-restyle-pizzadao-org.md.
//
// API kept stable: `card()`, `btn(kind, disabled?)`, `input()`,
// `pageContainer(fontFamily?)`, `tile(selected)`, `overlay()`,
// `loadingSpinner()`, `navBtn()`. A new `btn("accent")` variant is the loud
// brand CTA (tomato fill).

import type { CSSProperties } from "react";

// Elevated card surface used across feature pages. Slightly larger padding
// than the onboarding card variant.
export function card(): CSSProperties {
  return {
    border: "1px solid hsl(var(--rule) / 0.12)",
    borderRadius: "var(--radius)",
    padding: 24,
    boxShadow: "0 8px 30px hsl(var(--ink) / 0.06)",
    background: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    display: "grid",
    gap: 14,
  };
}

export function btn(
  kind: "primary" | "secondary" | "accent",
  disabled?: boolean,
): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: "var(--radius)",
    fontWeight: 600,
    fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    textDecoration: "none",
    textAlign: "center",
    border: "1px solid transparent",
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

export function input(): CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "var(--radius)",
    border: "1px solid hsl(var(--rule) / 0.22)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    appearance: "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
  };
}

export function pageContainer(fontFamily?: string): CSSProperties {
  return {
    minHeight: "100vh",
    background: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
    fontFamily: fontFamily || "var(--font-sans), system-ui, sans-serif",
    padding: "40px 20px",
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

export function overlay(): CSSProperties {
  return {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "hsl(var(--ink) / 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  };
}

export function loadingSpinner(): CSSProperties {
  return {
    width: 50,
    height: 50,
    border: "4px solid hsl(var(--ink) / 0.10)",
    borderTop: "4px solid hsl(var(--tomato))",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    margin: "0 auto 20px",
  };
}

export function navBtn(): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--rule) / 0.22)",
    borderRadius: "var(--radius)",
    color: "hsl(var(--card-foreground))",
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 600,
    transition: "background-color 150ms ease, border-color 150ms ease",
  };
}

// Badges / pills — new in Phase 2 for any consumer that wants a brand-styled
// tag without rolling their own inline style.
export function badge(kind: "default" | "accent" = "default"): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--font-sans), system-ui, sans-serif",
    whiteSpace: "nowrap",
  };
  if (kind === "accent") {
    return {
      ...base,
      background: "hsl(var(--tomato) / 0.10)",
      color: "hsl(var(--tomato))",
      border: "1px solid hsl(var(--tomato) / 0.30)",
    };
  }
  return {
    ...base,
    background: "hsl(var(--muted))",
    color: "hsl(var(--foreground))",
    border: "1px solid hsl(var(--rule) / 0.22)",
  };
}
