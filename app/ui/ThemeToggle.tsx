"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  const isDark = (resolvedTheme || theme) === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 10,
        border: "1px solid var(--color-border-strong)",
        background: "var(--color-surface)",
        color: "var(--color-text)",
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "inherit",
      }}
    >
      {isDark ? "\u2600\uFE0F" : "\uD83C\uDF19"} {isDark ? "Light Mode" : "Dark Mode"}
    </button>
  );
}
