"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ArticleRenderer from "./ArticleRenderer";
import CommentComposer, { type PostedComment } from "./CommentComposer";

interface CommentDTO {
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
  currentUserDiscordId: string | null;
  isAdmin: boolean;
}

const MAX = 500;

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function CommentRow({
  comment,
  currentUserDiscordId,
  isAdmin,
  onUpdated,
  onDeleted,
}: {
  comment: CommentDTO;
  currentUserDiscordId: string | null;
  isAdmin: boolean;
  onUpdated: (c: CommentDTO) => void;
  onDeleted: (c: CommentDTO) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthor = currentUserDiscordId !== null && currentUserDiscordId === comment.authorId;
  const canEdit = isAuthor && !comment.isDeleted;
  const canDelete = (isAuthor || isAdmin) && !comment.isDeleted;

  async function handleSave() {
    if (saving) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Comment cannot be empty");
      return;
    }
    if (trimmed.length > MAX) {
      setError(`Comment must be ${MAX} characters or fewer`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/comments/${comment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to update comment");
      }
      const data = await res.json();
      onUpdated({ ...comment, ...data.comment, authorMemberId: comment.authorMemberId });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update comment");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (saving) return;
    if (!confirm("Delete this comment? This cannot be undone.")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/comments/${comment.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to delete comment");
      }
      const data = await res.json();
      onDeleted({ ...comment, ...data.comment, authorMemberId: comment.authorMemberId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete comment");
    } finally {
      setSaving(false);
    }
  }

  const authorEl = comment.authorMemberId ? (
    <Link
      href={`/profile/${comment.authorMemberId}`}
      style={{ color: "var(--color-tomato, #2563eb)", textDecoration: "none", fontWeight: 600 }}
    >
      {comment.authorName || "Anonymous"}
    </Link>
  ) : (
    <span style={{ fontWeight: 600 }}>{comment.authorName || "Anonymous"}</span>
  );

  return (
    <article
      style={{
        padding: "14px 16px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 14, color: "var(--color-text-primary, var(--color-text))" }}>
          {authorEl}{" "}
          <span
            title={formatAbsolute(comment.createdAt)}
            style={{
              color: "var(--color-text-secondary, var(--color-text))",
              fontSize: 13,
            }}
          >
            · {formatRelative(comment.createdAt)}
            {comment.updatedAt !== comment.createdAt && !comment.isDeleted ? " (edited)" : ""}
          </span>
        </div>
        {(canEdit || canDelete) && !editing && (
          <div style={{ display: "flex", gap: 6 }}>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(true);
                  setError(null);
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border-strong, var(--color-border))",
                  background: "transparent",
                  color: "var(--color-text-secondary, var(--color-text))",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(220, 38, 38, 0.35)",
                  background: "transparent",
                  color: "var(--color-tomato-deep, #b91c1c)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </header>

      {comment.isDeleted ? (
        <p
          style={{
            margin: 0,
            fontStyle: "italic",
            color: "var(--color-text-secondary, var(--color-text))",
            opacity: 0.7,
          }}
        >
          [deleted]
        </p>
      ) : editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            rows={3}
            style={{
              width: "100%",
              padding: 10,
              fontFamily: "inherit",
              fontSize: 15,
              lineHeight: 1.5,
              color: "var(--color-text)",
              background: "var(--color-page-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
            <span
              style={{
                fontSize: 12,
                color: draft.length > 480 ? "var(--color-tomato)" : "var(--color-text-secondary)",
                fontVariantNumeric: "tabular-nums",
                marginRight: "auto",
              }}
            >
              {draft.length}/{MAX}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid var(--color-border-strong, var(--color-border))",
                background: "transparent",
                color: "var(--color-text)",
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid var(--color-border-strong, var(--color-border))",
                background: "var(--color-tomato)",
                color: "white",
                fontSize: 13,
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 15, lineHeight: 1.55 }}>
          <ArticleRenderer content={comment.body} />
        </div>
      )}

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
    </article>
  );
}

/**
 * Renders the comments thread + the composer for a given article slug.
 */
export default function CommentList({ slug, currentUserDiscordId, isAdmin }: Props) {
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${slug}/comments`);
      if (!res.ok) throw new Error("Failed to load comments");
      const data = await res.json();
      setComments(data.comments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePosted = (c: PostedComment) => {
    setComments((prev) => [...prev, c]);
  };

  const handleUpdated = (c: CommentDTO) => {
    setComments((prev) => prev.map((existing) => (existing.id === c.id ? c : existing)));
  };

  const handleDeleted = (c: CommentDTO) => {
    setComments((prev) => prev.map((existing) => (existing.id === c.id ? c : existing)));
  };

  return (
    <section
      aria-label="Comments"
      style={{
        marginTop: 48,
        paddingTop: 32,
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <h2
        style={{
          margin: "0 0 16px 0",
          fontSize: 22,
          fontWeight: 700,
          color: "var(--color-text-primary, var(--color-text))",
        }}
      >
        Comments{!loading && ` (${comments.length})`}
      </h2>

      {currentUserDiscordId ? (
        <CommentComposer slug={slug} onPosted={handlePosted} />
      ) : (
        <div
          style={{
            padding: 16,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            fontSize: 14,
            color: "var(--color-text-secondary, var(--color-text))",
          }}
        >
          <a
            href="/api/auth/discord"
            style={{
              color: "var(--color-tomato, #2563eb)",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Sign in
          </a>{" "}
          to join the conversation.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
        {loading && (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: 80,
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  animation: "pulse 1.5s infinite",
                }}
              />
            ))}
          </>
        )}

        {!loading && error && (
          <div
            role="alert"
            style={{
              padding: 12,
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid rgba(220, 38, 38, 0.35)",
              color: "var(--color-tomato-deep, #b91c1c)",
              borderRadius: 8,
              fontSize: 14,
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={load}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid rgba(220, 38, 38, 0.35)",
                background: "transparent",
                color: "var(--color-tomato-deep, #b91c1c)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && comments.length === 0 && (
          <p
            style={{
              margin: 0,
              padding: "16px 4px",
              color: "var(--color-text-secondary, var(--color-text))",
              fontSize: 14,
              fontStyle: "italic",
            }}
          >
            No comments yet — be the first to share your thoughts.
          </p>
        )}

        {!loading &&
          !error &&
          comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              currentUserDiscordId={currentUserDiscordId}
              isAdmin={isAdmin}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </section>
  );
}
