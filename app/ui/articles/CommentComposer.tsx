"use client";

// napoletana-41544 — Editorial restyle of the comment composer.
// Paper-soft form, overline label, handwritten "your two cents" margin
// annotation. POST flow + char cap behavior unchanged.

import { useState } from "react";

export interface PostedComment {
  id: number;
  articleId: number;
  authorId: string;
  authorName: string | null;
  authorMemberId: string | null;
  body: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  slug: string;
  disabled?: boolean;
  onPosted: (comment: PostedComment) => void;
}

const MAX = 500;

/**
 * Textarea + submit for posting a new comment.
 */
export default function CommentComposer({ slug, disabled, onPosted }: Props) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = body.trim().length;
  const tooLong = body.length > MAX;
  const canSubmit = !submitting && !disabled && trimmedLen > 0 && !tooLong;
  const counterClass = body.length > 480 ? "text-tomato" : "text-foreground/55";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${slug}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to post comment");
      }
      const data = await res.json();
      onPosted(data.comment);
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="paper-soft print-noise relative flex flex-col gap-2 p-4 sm:p-5 bg-card border border-[hsl(var(--rule-warm)/0.55)] rounded-[--radius]"
    >
      {/* Handwritten margin annotation — desktop only, doesn't crowd mobile */}
      <span
        aria-hidden
        className="handwritten pointer-events-none absolute -top-3 right-3 rotate-[-4deg] text-tomato hidden md:inline-block"
        style={{ fontSize: 15 }}
      >
        your two cents ↓
      </span>

      <label htmlFor="comment-body" className="overline text-foreground/55">
        Add a comment
      </label>
      <textarea
        id="comment-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={submitting || disabled}
        rows={4}
        placeholder="Share your thoughts… markdown supported."
        className={`w-full min-h-[88px] p-2.5 text-[15px] leading-relaxed rounded-[--radius] bg-[hsl(var(--cream))] dark:bg-background text-foreground border outline-none focus:border-[hsl(var(--tomato))] focus:ring-2 focus:ring-[hsl(var(--tomato)/0.25)] transition-colors resize-y box-border ${
          tooLong ? "border-[hsl(var(--tomato))]" : "border-[hsl(var(--rule-warm)/0.65)]"
        }`}
        style={{ fontFamily: "inherit" }}
      />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="overline text-foreground/55">
          Markdown supported. Be kind.
        </span>
        <div className="flex items-center gap-3">
          <span
            className={`overline ${counterClass}`}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {body.length}/{MAX}
          </span>
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-pill"
            style={{
              background: canSubmit ? "hsl(var(--tomato))" : "hsl(var(--foreground) / 0.10)",
              color: canSubmit ? "hsl(var(--cream))" : "hsl(var(--foreground) / 0.55)",
              boxShadow: canSubmit ? "var(--shadow-soft)" : "none",
              cursor: canSubmit ? "pointer" : "not-allowed",
              padding: "0.5rem 1.15rem",
              fontSize: "0.8rem",
            }}
          >
            {submitting ? "Posting…" : "Post comment"}
          </button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-1 px-2.5 py-2 rounded-md text-[13px] font-semibold bg-[hsl(var(--destructive)/0.10)] border border-[hsl(var(--destructive)/0.35)] text-[hsl(var(--destructive))]"
        >
          {error}
        </div>
      )}
    </form>
  );
}
