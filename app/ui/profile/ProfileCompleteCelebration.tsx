"use client";

// jalapeno-34126 — One-time "your profile is complete" celebration.
//
// Visual language matches MissionCompleteCelebration / LevelUpModal (ink
// scrim, paper-soft cream card, handwritten stamp, falling pizza confetti,
// btn-pill CTA). Differences, because this one is a real dialog with a link
// inside it:
//   * No auto-dismiss — the user closes it (button, Escape, or backdrop).
//   * Focus is trapped inside the card while open and restored on close.
//   * prefers-reduced-motion: confetti isn't rendered and the card doesn't
//     pop/scale — it just appears.
//
// Gating (show once, ever) lives in the caller: see ProfileCompleteCelebrationGate.

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";

export type ProfileCompleteCelebrationProps = {
  /** Steps shown as a ticked checklist, e.g. ["Join a crew", "Connect a wallet", "Connect X"]. */
  stepLabels: string[];
  /** Optional "view profile" destination. */
  profileHref?: string;
  onDismiss: () => void;
};

const DISPLAY_FONT = "var(--font-display), var(--font-sans), system-ui, sans-serif";
const CONFETTI_PIECES = 18;
const EMOJI_POOL = ["🍕", "🍅", "✨"];

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener?.("change", onChange);
  return () => mql.removeEventListener?.("change", onChange);
}

function getReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** SSR-safe (server snapshot = false; the CSS media query covers that frame). */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
}

function buildPieces(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    emoji: EMOJI_POOL[i % EMOJI_POOL.length],
    left: Math.round(((i + 0.5) / count) * 100 + (((i * 37) % 11) - 5)),
    delay: ((i * 113) % 900) / 1000,
    duration: 2.8 + ((i * 47) % 14) / 10,
    size: 24 + ((i * 31) % 18),
  }));
}

export function ProfileCompleteCelebration({
  stepLabels,
  profileHref,
  onDismiss,
}: ProfileCompleteCelebrationProps) {
  const titleId = useId();
  const descId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const pieces = useMemo(() => (reducedMotion ? [] : buildPieces(CONFETTI_PIECES)), [reducedMotion]);

  // Keep the latest onDismiss without re-running the mount effect.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  const dismiss = useCallback(() => onDismissRef.current(), []);

  // Focus management: move focus in on open, restore on close, lock scroll.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, []);

  // Escape to close + Tab focus trap.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focusables = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && cardRef.current.contains(active);
      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  return (
    <div
      data-testid="profile-complete-celebration"
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "hsl(var(--ink) / 0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        padding: 16,
      }}
    >
      {/* Falling confetti — omitted entirely under reduced motion */}
      {pieces.length > 0 && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {pieces.map((p, idx) => (
            <span
              key={idx}
              className="jalapeno-confetti-piece"
              data-testid="profile-confetti-piece"
              style={{
                position: "absolute",
                top: -40,
                left: `${p.left}%`,
                fontSize: p.size,
                animation: `jalapeno-fall ${p.duration}s linear ${p.delay}s 2 both`,
                willChange: "transform",
              }}
            >
              {p.emoji}
            </span>
          ))}
        </div>
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        className="paper-soft halftone-soft jalapeno-card"
        style={{
          position: "relative",
          maxWidth: 460,
          width: "calc(100% - 32px)",
          padding: "34px 28px 28px",
          borderRadius: "var(--radius)",
          border: "1px solid hsl(var(--rule-warm) / 0.55)",
          background: "hsl(var(--cream))",
          color: "hsl(var(--foreground))",
          boxShadow: "var(--shadow-lifted)",
          textAlign: "center",
        }}
      >
        {/* Handwritten stamp */}
        <span
          aria-hidden
          className="handwritten"
          style={{
            position: "absolute",
            top: 14,
            right: 20,
            fontSize: 18,
            transform: "rotate(-8deg)",
            color: "hsl(var(--tomato))",
            opacity: 0.85,
            pointerEvents: "none",
          }}
        >
          on file
        </span>

        <div aria-hidden="true" style={{ fontSize: 56, lineHeight: 1, marginBottom: 10 }}>
          {"🍕"}
        </div>
        <span
          className="overline"
          style={{ color: "hsl(var(--tomato))", display: "block", marginBottom: 6 }}
        >
          § Profile complete
        </span>
        <h2
          id={titleId}
          style={{
            margin: 0,
            fontSize: "clamp(1.5rem, 5vw, 1.85rem)",
            fontFamily: DISPLAY_FONT,
            fontWeight: 900,
            letterSpacing: "-0.015em",
            lineHeight: 1.05,
            color: "hsl(var(--foreground))",
          }}
        >
          You&rsquo;re all set up!
        </h2>
        <p
          id={descId}
          style={{
            margin: "10px 0 0",
            fontSize: 14,
            color: "hsl(var(--muted-foreground))",
            lineHeight: 1.5,
          }}
        >
          Your file is complete — the Family can find you, vouch for you, and see your collection.
        </p>

        {stepLabels.length > 0 && (
          <ul
            aria-label="Completed steps"
            style={{
              listStyle: "none",
              margin: "16px auto 0",
              padding: 0,
              display: "inline-grid",
              gap: 6,
              textAlign: "left",
              fontSize: 14,
            }}
          >
            {stepLabels.map((label) => (
              <li key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  aria-hidden
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                    fontSize: 11,
                    fontWeight: 900,
                  }}
                >
                  ✓
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        )}

        <div
          style={{
            marginTop: 22,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <button
            ref={primaryRef}
            type="button"
            onClick={dismiss}
            className="btn-pill"
            style={{
              minWidth: 140,
              background: "hsl(var(--ink))",
              color: "hsl(var(--cream))",
              border: "1px solid transparent",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            Nice!
          </button>
          {profileHref && (
            <Link
              href={profileHref}
              onClick={dismiss}
              className="ui text-[12px] uppercase tracking-[0.22em] text-foreground/65 hover:text-tomato"
              style={{ textDecoration: "underline", textUnderlineOffset: 4, padding: 10 }}
            >
              View your profile
            </Link>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes jalapeno-fall {
          0% {
            transform: translateY(-10vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(110vh) rotate(540deg);
            opacity: 0.85;
          }
        }
        @keyframes jalapeno-pop {
          0% {
            transform: scale(0.85);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        :global(.jalapeno-card) {
          animation: jalapeno-pop 420ms cubic-bezier(0.2, 1, 0.3, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.jalapeno-confetti-piece) {
            display: none !important;
          }
          :global(.jalapeno-card) {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
