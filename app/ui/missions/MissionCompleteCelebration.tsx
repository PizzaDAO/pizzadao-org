"use client";

import { useEffect, useMemo, useState } from "react";
import { btn } from "../shared-styles";

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
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: closing ? 0 : 1,
        transition: "opacity 300ms ease",
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

      {/* Centered content card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          maxWidth: 440,
          width: "calc(100% - 32px)",
          padding: "32px 28px",
          borderRadius: 18,
          background: "var(--color-surface)",
          color: "var(--color-text)",
          boxShadow: "var(--shadow-elevated)",
          textAlign: "center",
          animation: "diavola-pop 420ms cubic-bezier(0.2, 1, 0.3, 1)",
        }}
      >
        <div
          style={{
            fontSize: 56,
            lineHeight: 1,
            marginBottom: 12,
          }}
          aria-hidden="true"
        >
          {"🍕"}
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 800,
            color: "var(--color-accent)",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.75 }}>
            {subtitle}
          </p>
        )}
        <button
          onClick={handleDismiss}
          style={{
            ...btn("primary"),
            marginTop: 20,
            minWidth: 140,
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
