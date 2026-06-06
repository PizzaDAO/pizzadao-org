"use client";

// capricciosa-10448 — Light editorial polish on the vouch prompt card so it
// reads as a margin-note nudge inside the dossier. Props, the "Find members"
// → /crew href, the "Maybe later" text, and the data-testid are unchanged —
// tests rely on them.
//
// Prior: diavola-40350 — vouch prompt card.

import Link from "next/link";

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

type Props = {
  /** Fires when the user clicks "Maybe later" or the "Find members" link. */
  onDismiss: () => void;
};

/**
 * Shown once, after a member's first-ever mission completion. Nudges them to
 * collect vouches so other members can see their contributions.
 */
export function VouchPromptCard({ onDismiss }: Props) {
  return (
    <div
      data-testid="vouch-prompt-card"
      className="paper-soft"
      style={{
        position: "relative",
        borderRadius: "var(--radius)",
        border: "2px solid hsl(var(--tomato))",
        background: "hsl(var(--cream))",
        boxShadow: "var(--shadow-lifted)",
        padding: 22,
        display: "grid",
        gap: 14,
      }}
    >
      {/* Handwritten "ps!" margin note */}
      <span
        aria-hidden
        className="handwritten"
        style={{
          position: "absolute",
          top: 10,
          right: 18,
          fontSize: 18,
          transform: "rotate(-9deg)",
          color: "hsl(var(--tomato) / 0.8)",
          pointerEvents: "none",
        }}
      >
        ps!
      </span>

      <div>
        <span
          className="overline"
          style={{
            color: "hsl(var(--tomato))",
            display: "block",
            marginBottom: 4,
          }}
        >
          § A nudge
        </span>
        <h3
          style={{
            margin: 0,
            fontSize: "clamp(1.15rem, 3vw, 1.4rem)",
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            letterSpacing: "-0.015em",
            lineHeight: 1.1,
            color: "hsl(var(--foreground))",
          }}
        >
          Ask 3 members to vouch for you
        </h3>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: "hsl(var(--foreground) / 0.75)",
          lineHeight: 1.55,
        }}
      >
        Vouches let other members see your contributions and unlock community
        trust. Find three people you have collaborated with and ask them to
        vouch.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          href="/crew"
          onClick={onDismiss}
          className="btn-pill"
          style={{
            textDecoration: "none",
            fontSize: 14,
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
            border: "1px solid transparent",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          Find members
        </Link>
        <button
          onClick={onDismiss}
          className="btn-pill"
          style={{
            fontSize: 14,
            background: "transparent",
            color: "hsl(var(--foreground))",
            border: "1px solid hsl(var(--rule-warm) / 0.7)",
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
