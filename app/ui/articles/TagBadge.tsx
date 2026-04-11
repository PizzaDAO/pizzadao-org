"use client";

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
      ? "var(--color-btn-primary-bg)"
      : "var(--color-surface-hover, rgba(0,0,0,0.04))",
    color: active
      ? "var(--color-btn-primary-text)"
      : "var(--color-text-secondary, var(--color-text))",
    border: `1px solid ${active ? "var(--color-btn-primary-border)" : "var(--color-border)"}`,
    textDecoration: "none",
    cursor: href || onClick ? "pointer" : "default",
    whiteSpace: "nowrap",
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
