"use client";

import Link from "next/link";
import { btn, card } from "../shared-styles";

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
      style={{
        ...card(),
        gap: 12,
        borderColor: "var(--color-accent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 24 }} aria-hidden="true">
          🤝
        </span>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
          Ask 3 members to vouch for you
        </h3>
      </div>
      <p style={{ margin: 0, fontSize: 14, opacity: 0.8, lineHeight: 1.45 }}>
        Vouches let other members see your contributions and unlock community
        trust. Find three people you have collaborated with and ask them to
        vouch.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          href="/crew"
          onClick={onDismiss}
          style={{
            ...btn("primary"),
            textDecoration: "none",
            fontSize: 14,
          }}
        >
          Find members
        </Link>
        <button
          onClick={onDismiss}
          style={{
            ...btn("secondary"),
            fontSize: 14,
          }}
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
