"use client";

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
 *
 * Mirrors the 500-char server cap with a live counter. Submits via the
 * `/api/articles/{slug}/comments` POST endpoint and surfaces validation +
 * rate-limit errors inline.
 */
export default function CommentComposer({ slug, disabled, onPosted }: Props) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = body.trim().length;
  const tooLong = body.length > MAX;
  const counterColor = body.length > 480 ? "var(--color-tomato)" : "var(--color-text-secondary)";
  const canSubmit = !submitting && !disabled && trimmedLen > 0 && !tooLong;

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
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 16,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
      }}
    >
      <label
        htmlFor="comment-body"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-text-primary, var(--color-text))",
        }}
      >
        Add a comment
      </label>
      <textarea
        id="comment-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={submitting || disabled}
        rows={4}
        placeholder="Share your thoughts… markdown supported."
        style={{
          width: "100%",
          minHeight: 88,
          padding: 10,
          fontFamily: "inherit",
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--color-text)",
          background: "var(--color-page-bg)",
          border: `1px solid ${tooLong ? "var(--color-tomato)" : "var(--color-border)"}`,
          borderRadius: 8,
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary, var(--color-text))",
            opacity: 0.8,
          }}
        >
          Markdown supported. Be kind.
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: counterColor, fontVariantNumeric: "tabular-nums" }}>
            {body.length}/{MAX}
          </span>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--color-border-strong, var(--color-border))",
              background: canSubmit ? "var(--color-tomato)" : "var(--color-surface)",
              color: canSubmit ? "white" : "var(--color-text-secondary, var(--color-text))",
              fontSize: 14,
              fontWeight: 600,
              cursor: canSubmit ? "pointer" : "not-allowed",
              minHeight: 36,
            }}
          >
            {submitting ? "Posting…" : "Post comment"}
          </button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            marginTop: 4,
            padding: "8px 10px",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.35)",
            color: "var(--color-tomato-deep, #b91c1c)",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
