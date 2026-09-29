"use client";

// Inline "please log in" prompt — replaces alert("Please log in to …").
// Render it where the action was attempted; it links to /login and can be
// dismissed. Scrolls itself into view on mount so it is never missed.

import Link from "next/link";
import { useEffect, useRef } from "react";

export function LoginPrompt({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [message]);

  return (
    <div
      ref={ref}
      role="alert"
      className="fade-up flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm"
      style={{
        borderColor: "hsl(var(--tomato) / 0.45)",
        background: "hsl(var(--tomato) / 0.06)",
        color: "hsl(var(--foreground))",
        animationDuration: "0.35s",
      }}
    >
      <span className="overline" style={{ color: "hsl(var(--tomato))" }}>
        Members only
      </span>
      <span className="flex-1" style={{ minWidth: 160 }}>
        {message}
      </span>
      <Link
        href="/login"
        className="btn-pill"
        style={{
          background: "hsl(var(--foreground))",
          color: "hsl(var(--background))",
          textDecoration: "none",
          padding: "0.5rem 1.1rem",
          minHeight: 36,
        }}
      >
        Log in
      </Link>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-foreground/55 hover:text-foreground"
          style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 13 }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
