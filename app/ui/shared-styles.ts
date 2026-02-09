import type { CSSProperties } from "react";

export function card(): CSSProperties {
  return {
    border: "1px solid var(--color-border)",
    borderRadius: 14,
    padding: 24,
    boxShadow: "var(--shadow-card)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    display: "grid",
    gap: 14,
  };
}

export function btn(kind: "primary" | "secondary", disabled?: boolean): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: 10,
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    textDecoration: "none",
    textAlign: "center",
  };
  if (kind === "primary") {
    return { ...base, background: "var(--color-btn-primary-bg)", color: "var(--color-btn-primary-text)", border: "1px solid var(--color-btn-primary-border)" };
  }
  return { ...base, background: "var(--color-btn-secondary-bg)", color: "var(--color-btn-secondary-text)", border: "1px solid var(--color-btn-secondary-border)" };
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

export function pageContainer(fontFamily?: string): CSSProperties {
  return {
    minHeight: "100vh",
    background: "var(--color-page-bg)",
    color: "var(--color-text)",
    fontFamily: fontFamily || "inherit",
    padding: "40px 20px",
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

export function overlay(): CSSProperties {
  return {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "var(--color-overlay)",
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
    border: "4px solid var(--color-spinner-track)",
    borderTop: "4px solid var(--color-spinner-active)",
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
    background: "var(--color-surface)",
    border: "1px solid var(--color-border-strong)",
    borderRadius: 8,
    color: "var(--color-text)",
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 600,
  };
}
