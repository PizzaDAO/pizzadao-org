"use client";

// napoletana-41544 — Editorial restyle. Tags read like editorial pills:
// uppercase micro-type, warm rule border, tomato accent on the active
// state. # prefix retained for "filed under" semantics.

import Link from "next/link";
import type { CSSProperties } from "react";

interface TagBadgeProps {
  tag: string;
  href?: string;
  onClick?: () => void;
  size?: "sm" | "md";
  active?: boolean;
}

export default function TagBadge({ tag, href, onClick, size = "md", active = false }: TagBadgeProps) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: size === "sm" ? "2px 9px" : "4px 11px",
    borderRadius: 999,
    fontSize: size === "sm" ? 10 : 11,
    fontWeight: 600,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    background: active
      ? "hsl(var(--tomato) / 0.12)"
      : "transparent",
    color: active
      ? "hsl(var(--tomato))"
      : "hsl(var(--foreground) / 0.75)",
    border: `1px solid ${active ? "hsl(var(--tomato) / 0.55)" : "hsl(var(--rule-warm) / 0.7)"}`,
    textDecoration: "none",
    cursor: href || onClick ? "pointer" : "default",
    whiteSpace: "nowrap",
    transition: "background-color 180ms ease, border-color 180ms ease, color 180ms ease",
    lineHeight: 1.5,
  };

  if (href) {
    return (
      <Link href={href} style={style} onClick={(e) => e.stopPropagation()}>
        #{tag}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        style={{ ...style, border: style.border }}
      >
        #{tag}
      </button>
    );
  }

  return <span style={style}>#{tag}</span>;
}
