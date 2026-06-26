"use client";

// napoletana-41544 — Editorial restyle of the reactions row.
// Replaces the inline-styled CSS-var pills with editorial primitives:
// overline section label, hairline rule, btn-pill-shaped reaction
// buttons that fill tomato when active. Reaction logic + API calls
// preserved verbatim.

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
      setState(prevState);
      setError(err instanceof Error ? err.message : "Failed to update reaction");
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="Reactions" className="mt-10 pt-7">
      <div className="rule mb-5" />
      <p className="overline text-foreground/55 mb-3">React to this piece</p>
      <div
        role="group"
        aria-label="React to this article"
        className="flex flex-wrap gap-2 items-center"
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
              className="btn-pill"
              style={{
                background: active ? "hsl(var(--tomato))" : "transparent",
                color: active ? "hsl(var(--cream))" : "hsl(var(--foreground))",
                border: active
                  ? "1px solid hsl(var(--tomato))"
                  : "1px solid hsl(var(--foreground) / 0.20)",
                boxShadow: active ? "var(--shadow-soft)" : "none",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled && !active ? 0.55 : 1,
                transform: isPending ? "scale(0.97)" : "none",
                padding: "0.5rem 1rem",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              <span style={{ fontSize: 18 }} aria-hidden>
                {emoji}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{count}</span>
            </button>
          );
        })}
        {!currentUserDiscordId && (
          <span className="overline ml-1 text-foreground/55">
            <a
              href="/api/auth/discord"
              className="text-tomato hover:text-[hsl(var(--tomato-deep))] no-underline transition-colors font-semibold"
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
          className="mt-3 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[hsl(var(--destructive)/0.10)] border border-[hsl(var(--destructive)/0.35)] text-[hsl(var(--destructive))]"
        >
          {error}
        </div>
      )}
    </section>
  );
}
