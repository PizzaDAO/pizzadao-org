"use client";

import { useCallback, useEffect, useState } from "react";

// Glyphs in the order they render. The API speaks glyphs back to us, so
// this list is also the set of valid `myReaction` values.
const EMOJIS = ["👍", "❤️", "🍕"] as const;
type Emoji = (typeof EMOJIS)[number];

interface ReactionState {
  counts: Record<Emoji, number>;
  myReaction: Emoji | null;
}

interface Props {
  slug: string;
  currentUserDiscordId: string | null;
}

function emptyCounts(): Record<Emoji, number> {
  return { "👍": 0, "❤️": 0, "🍕": 0 };
}

function isEmoji(v: unknown): v is Emoji {
  return typeof v === "string" && (EMOJIS as readonly string[]).includes(v);
}

/**
 * Normalize whatever the server sends into a fully-populated counts record
 * (server might omit zero buckets in older clients; we tolerate that).
 */
function readCounts(raw: unknown): Record<Emoji, number> {
  const out = emptyCounts();
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const e of EMOJIS) {
      const v = obj[e];
      if (typeof v === "number" && Number.isFinite(v)) out[e] = v;
    }
  }
  return out;
}

/**
 * Three-emoji reaction row, rendered below the article body. Logged-out
 * viewers see read-only counts. Logged-in members can toggle their pick
 * (same-emoji click clears it, different emoji swaps).
 */
export default function ArticleReactions({ slug, currentUserDiscordId }: Props) {
  const [state, setState] = useState<ReactionState>({
    counts: emptyCounts(),
    myReaction: null,
  });
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Emoji | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${slug}/reactions`);
      if (!res.ok) throw new Error("Failed to load reactions");
      const data = await res.json();
      setState({
        counts: readCounts(data?.counts),
        myReaction: isEmoji(data?.myReaction) ? data.myReaction : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reactions");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleClick(emoji: Emoji) {
    if (!currentUserDiscordId || pending) return;

    const isClearing = state.myReaction === emoji;

    // Optimistic update so the click feels instant.
    const prevState = state;
    const optimisticCounts = { ...state.counts };
    if (state.myReaction) optimisticCounts[state.myReaction] = Math.max(0, optimisticCounts[state.myReaction] - 1);
    if (!isClearing) optimisticCounts[emoji] = (optimisticCounts[emoji] ?? 0) + 1;
    setState({
      counts: optimisticCounts,
      myReaction: isClearing ? null : emoji,
    });
    setPending(emoji);
    setError(null);

    try {
      const res = isClearing
        ? await fetch(`/api/articles/${slug}/reactions`, { method: "DELETE" })
        : await fetch(`/api/articles/${slug}/reactions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emoji }),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to update reaction");
      }
      const data = await res.json();
      setState({
        counts: readCounts(data?.counts),
        myReaction: isEmoji(data?.myReaction) ? data.myReaction : null,
      });
    } catch (err) {
      // Roll back to whatever the server last told us was true.
      setState(prevState);
      setError(err instanceof Error ? err.message : "Failed to update reaction");
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-label="Reactions"
      style={{
        marginTop: 32,
        paddingTop: 24,
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        role="group"
        aria-label="React to this article"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        {EMOJIS.map((emoji) => {
          const active = state.myReaction === emoji;
          const count = state.counts[emoji] ?? 0;
          const isPending = pending === emoji;
          const disabled =
            loading || !currentUserDiscordId || (pending !== null && pending !== emoji);
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => handleClick(emoji)}
              disabled={disabled}
              aria-pressed={active}
              aria-label={
                currentUserDiscordId
                  ? active
                    ? `Remove your ${emoji} reaction (currently ${count})`
                    : `React with ${emoji} (currently ${count})`
                  : `${emoji} reaction (currently ${count}) — sign in to react`
              }
              title={
                currentUserDiscordId
                  ? active
                    ? `Click to remove your ${emoji}`
                    : `React with ${emoji}`
                  : "Sign in to react"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                minHeight: 36,
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 16,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled && !active ? 0.6 : 1,
                background: active ? "var(--color-tomato, #b91c1c)" : "var(--color-surface)",
                color: active ? "white" : "var(--color-text, inherit)",
                border: active
                  ? "1px solid var(--color-tomato, #b91c1c)"
                  : "1px solid var(--color-border)",
                transition: "background 120ms ease, border-color 120ms ease, transform 80ms ease",
                transform: isPending ? "scale(0.97)" : "none",
              }}
            >
              <span style={{ fontSize: 18 }} aria-hidden="true">
                {emoji}
              </span>
              <span style={{ fontSize: 13 }}>{count}</span>
            </button>
          );
        })}
        {!currentUserDiscordId && (
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-secondary, var(--color-text))",
              marginLeft: 4,
            }}
          >
            <a
              href="/api/auth/discord"
              style={{
                color: "var(--color-tomato, #b91c1c)",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Sign in
            </a>{" "}
            to react
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            padding: "6px 10px",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.35)",
            color: "var(--color-tomato-deep, #b91c1c)",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
