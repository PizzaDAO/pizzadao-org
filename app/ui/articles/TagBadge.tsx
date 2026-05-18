"use client";

// truffle-11395 (Restyle Phase 2): consume the new semantic HSL tokens
// directly. Active variant uses the tomato accent; inactive uses muted.

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
    display: "inline-block",
    padding: size === "sm" ? "2px 8px" : "4px 10px",
    borderRadius: 999,
    fontSize: size === "sm" ? 11 : 12,
    fontWeight: 600,
    background: active
      ? "hsl(var(--tomato) / 0.10)"
      : "hsl(var(--muted))",
    color: active
      ? "hsl(var(--tomato))"
      : "hsl(var(--foreground))",
    border: `1px solid ${active ? "hsl(var(--tomato) / 0.30)" : "hsl(var(--rule) / 0.22)"}`,
    textDecoration: "none",
    cursor: href || onClick ? "pointer" : "default",
    whiteSpace: "nowrap",
    transition: "background-color 150ms ease, border-color 150ms ease",
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
