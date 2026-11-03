"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type QuickVouchButtonProps = {
  targetMemberId: string;
  vouched: boolean;
  onVouched: () => void;
  /** Server-computed flag from the session: only these viewers ever call the disavow check. */
  canViewDisavow?: boolean;
};

/**
 * One-click Vouch for the members list (/crew). Same rules as the profile button (POST
 * /api/vouches/add -> give-vouch.ts, including the daily limit). A viewer who is eligible to see the
 * disavow list is sent to the profile instead when the member is listed, where the warning dialog
 * lives (warn, never block). Undo stays on the profile.
 */
export function QuickVouchButton({ targetMemberId, vouched, onVouched, canViewDisavow }: QuickVouchButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function click() {
    setBusy(true);
    setError(null);
    try {
      if (canViewDisavow) {
        try {
          const check = await fetch(`/api/disavow/check?memberId=${encodeURIComponent(targetMemberId)}`, { credentials: "include" });
          if (check.ok && (await check.json())?.listed) {
            router.push(`/profile/${encodeURIComponent(targetMemberId)}`);
            return;
          }
        } catch {
          // A failed check never blocks a vouch.
        }
      }
      const res = await fetch("/api/vouches/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetMemberId }),
      });
      if (res.ok || res.status === 409) {
        onVouched();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(typeof body?.error === "string" ? body.error : "Could not vouch. Try again.");
    } catch {
      setError("Could not vouch. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        type="button"
        onClick={click}
        disabled={busy || vouched}
        aria-label={vouched ? "Vouched" : "Vouch for this member"}
        style={{
          minHeight: 36,
          padding: "6px 14px",
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 700,
          cursor: busy ? "wait" : vouched ? "default" : "pointer",
          border: vouched ? "1px solid hsl(var(--rule) / 0.22)" : "1px solid hsl(var(--tomato))",
          background: vouched ? "transparent" : "hsl(var(--tomato))",
          color: vouched ? "hsl(var(--muted-foreground))" : "hsl(var(--cream))",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "..." : vouched ? "Vouched ✓" : "+ Vouch"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "hsl(var(--tomato-deep))", maxWidth: 220, textAlign: "right" }}>
          {error}
        </span>
      )}
    </div>
  );
}
