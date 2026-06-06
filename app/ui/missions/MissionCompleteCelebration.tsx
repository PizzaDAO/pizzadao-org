"use client";

// capricciosa-10448 — Light editorial polish on the celebration overlay so
// it doesn't visually clash with the new dossier mission cards. Props,
// auto-dismiss timer, data-testid, and string text ("Mission Complete!",
// "Nice!") are unchanged — tests rely on them.
//
// Prior history: diavola-40350 — first-mission celebration overlay.

import { useEffect, useMemo, useState } from "react";

type Props = {
  /** Optional title override (default: "Mission Complete!") */
  title?: string;
  /** Optional subtitle (e.g. mission name). */
  subtitle?: string;
  /** Called when the user clicks dismiss, clicks the backdrop, or auto-fade fires. */
  onDismiss: () => void;
  /**
   * Auto-dismiss delay (ms). Default 4500ms. Set to 0 to disable auto-dismiss.
   * Test override.
   */
  autoDismissMs?: number;
};

const CONFETTI_PIECES = 16;
const EMOJI_POOL = ["🍕", "🍅", "✨"]; // pizza, tomato, sparkle

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

type Piece = {
  emoji: string;
  left: number;
  delay: number;
  duration: number;
  rotation: number;
  size: number;
};

function buildPieces(count: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i += 1) {
    pieces.push({
      emoji: EMOJI_POOL[i % EMOJI_POOL.length],
      // deterministic-ish spread: stagger across viewport
      left: Math.round(((i + 0.5) / count) * 100 + (((i * 37) % 11) - 5)),
      delay: ((i * 113) % 800) / 1000,
      duration: 2.6 + ((i * 47) % 14) / 10, // 2.6 - 4.0 s
      rotation: ((i * 53) % 360) - 180,
      size: 26 + ((i * 31) % 18), // 26 - 43px
    });
  }
  return pieces;
}

export function MissionCompleteCelebration({
  title = "Mission Complete!",
  subtitle,
  onDismiss,
  autoDismissMs = 4500,
}: Props) {
  const [closing, setClosing] = useState(false);
  const pieces = useMemo(() => buildPieces(CONFETTI_PIECES), []);

  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const t = window.setTimeout(() => {
      setClosing(true);
      // give the fade-out 300ms before unmounting
      window.setTimeout(onDismiss, 300);
    }, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  function handleDismiss() {
    setClosing(true);
    window.setTimeout(onDismiss, 200);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mission complete celebration"
      onClick={handleDismiss}
      data-testid="mission-celebration-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "hsl(var(--ink) / 0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: closing ? 0 : 1,
        transition: "opacity 300ms ease",
        padding: 16,
      }}
    >
      {/* Falling confetti layer */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        {pieces.map((p, idx) => (
          <span
            key={idx}
            className="diavola-confetti-piece"
            style={{
              position: "absolute",
              top: -40,
              left: `${p.left}%`,
              fontSize: p.size,
              animation: `diavola-fall ${p.duration}s linear ${p.delay}s infinite`,
              transform: `rotate(${p.rotation}deg)`,
              willChange: "transform",
            }}
          >
            {p.emoji}
          </span>
        ))}
      </div>

      {/* Centered content card — paper-soft dossier */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="paper-soft halftone-soft"
        style={{
          position: "relative",
          maxWidth: 460,
          width: "calc(100% - 32px)",
          padding: "36px 30px 30px",
          borderRadius: "var(--radius)",
          border: "1px solid hsl(var(--rule-warm) / 0.55)",
          background: "hsl(var(--cream))",
          color: "hsl(var(--foreground))",
          boxShadow: "var(--shadow-lifted)",
          textAlign: "center",
          animation: "diavola-pop 420ms cubic-bezier(0.2, 1, 0.3, 1)",
        }}
      >
        {/* Handwritten "approved" stamp */}
        <span
          aria-hidden
          className="handwritten"
          style={{
            position: "absolute",
            top: 14,
            right: 20,
            fontSize: 18,
            transform: "rotate(-8deg)",
            color: "rgb(4, 120, 87)",
            opacity: 0.8,
            pointerEvents: "none",
          }}
        >
          approved
        </span>

        <div
          style={{
            fontSize: 60,
            lineHeight: 1,
            marginBottom: 12,
          }}
          aria-hidden="true"
        >
          {"🍕"}
        </div>
        <span
          className="overline"
          style={{
            color: "hsl(var(--tomato))",
            display: "block",
            marginBottom: 6,
          }}
        >
          § Filed
        </span>
        <h2
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
          {title}
        </h2>
        {subtitle && (
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 14,
              color: "hsl(var(--muted-foreground))",
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        )}
        <button
          onClick={handleDismiss}
          className="btn-pill"
          style={{
            marginTop: 22,
            minWidth: 140,
            background: "hsl(var(--ink))",
            color: "hsl(var(--cream))",
            border: "1px solid transparent",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          Nice!
        </button>
      </div>

      <style jsx>{`
        @keyframes diavola-fall {
          0% {
            transform: translateY(-10vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(110vh) rotate(540deg);
            opacity: 0.85;
          }
        }
        @keyframes diavola-pop {
          0% {
            transform: scale(0.85);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.diavola-confetti-piece) {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
