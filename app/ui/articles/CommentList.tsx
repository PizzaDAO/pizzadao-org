"use client";

// napoletana-41544 — Editorial restyle of the comments thread.
// Section gets a § ··· "Letters to the editor" overline + display heading
// rule. Each comment card sits on a paper-soft surface with warm rule
// borders. Edit/delete actions become quiet pill buttons.

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
      className="text-tomato hover:text-[hsl(var(--tomato-deep))] transition-colors no-underline font-semibold"
    >
      {comment.authorName || "Anonymous"}
    </Link>
  ) : (
    <span className="font-semibold">{comment.authorName || "Anonymous"}</span>
  );

  return (
    <article className="paper-soft px-4 py-4 sm:px-5 sm:py-4 bg-card text-card-foreground border border-[hsl(var(--rule-warm)/0.55)] rounded-[--radius]">
      <header className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="text-sm text-foreground/85">
          {authorEl}{" "}
          <span
            title={formatAbsolute(comment.createdAt)}
            className="overline ml-1 text-foreground/50"
          >
            <span aria-hidden className="mr-1.5 opacity-50">·</span>
            {formatRelative(comment.createdAt)}
            {comment.updatedAt !== comment.createdAt && !comment.isDeleted ? " (edited)" : ""}
          </span>
        </div>
        {(canEdit || canDelete) && !editing && (
          <div className="flex gap-1.5">
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(true);
                  setError(null);
                }}
                className="overline px-2.5 py-1 rounded-full border border-[hsl(var(--foreground)/0.20)] bg-transparent text-foreground/60 hover:bg-[hsl(var(--ink)/0.06)] hover:text-foreground dark:hover:bg-[hsl(var(--cream)/0.06)] transition-colors cursor-pointer"
              >
                Edit
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="overline px-2.5 py-1 rounded-full border border-[hsl(var(--destructive)/0.40)] bg-transparent text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.10)] disabled:cursor-not-allowed disabled:opacity-60 transition-colors cursor-pointer"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </header>

      {comment.isDeleted ? (
        <p className="italic text-foreground/50 m-0">[deleted]</p>
      ) : editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            rows={3}
            className="w-full p-2.5 text-[15px] leading-relaxed rounded-[--radius] bg-[hsl(var(--cream))] dark:bg-background text-foreground border border-[hsl(var(--rule-warm)/0.65)] outline-none focus:border-[hsl(var(--tomato))] focus:ring-2 focus:ring-[hsl(var(--tomato)/0.25)] transition-colors resize-y box-border"
            style={{ fontFamily: "inherit" }}
          />
          <div className="flex items-center gap-2 justify-end flex-wrap">
            <span
              className={`overline mr-auto ${draft.length > 480 ? "text-tomato" : "text-foreground/50"}`}
              style={{ fontVariantNumeric: "tabular-nums" }}
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
              className="btn-pill"
              style={{
                background: "transparent",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--foreground) / 0.20)",
                padding: "0.45rem 1rem",
                fontSize: "0.8rem",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-pill"
              style={{
                background: "hsl(var(--tomato))",
                color: "hsl(var(--cream))",
                padding: "0.45rem 1.15rem",
                fontSize: "0.8rem",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[15px] leading-relaxed">
          {/* Note: ArticleRenderer drops a first-paragraph drop cap globally; comments
              are short enough that we deliberately let it render plainly here — the
              cap targets `.article-content > p:first-child` which is fine because
              this nested instance still scopes to its own .article-content wrapper. */}
          <ArticleRenderer content={comment.body} />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-2 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[hsl(var(--destructive)/0.10)] border border-[hsl(var(--destructive)/0.35)] text-[hsl(var(--destructive))]"
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
    <section aria-label="Comments" className="mt-12 pt-8">
      <div className="rule-thick mb-4" />
      <div className="flex items-end justify-between gap-3 mb-5">
        <div>
          <p className="overline text-tomato">
            <span aria-hidden>§</span>
            <span aria-hidden className="mx-2 opacity-50">···</span>
            Letters to the editor
          </p>
          <h2 className="font-display text-2xl md:text-3xl font-black tracking-tight text-foreground mt-2 mb-0">
            Comments
            {!loading && (
              <span className="ml-2 align-middle text-foreground/45 text-xl font-bold">
                {comments.length}
              </span>
            )}
          </h2>
        </div>
      </div>

      {currentUserDiscordId ? (
        <CommentComposer slug={slug} onPosted={handlePosted} />
      ) : (
        <div className="paper-soft px-4 py-4 bg-card border border-[hsl(var(--rule-warm)/0.55)] rounded-[--radius] text-sm text-foreground/75">
          <a
            href="/api/auth/discord"
            className="text-tomato hover:text-[hsl(var(--tomato-deep))] font-semibold no-underline transition-colors"
          >
            Sign in
          </a>{" "}
          to join the conversation.
        </div>
      )}

      <div className="flex flex-col gap-3 mt-5">
        {loading && (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="paper-soft h-20 bg-card border border-[hsl(var(--rule-warm)/0.55)] rounded-[--radius]"
                style={{ animation: "pulse 1.5s infinite" }}
              />
            ))}
          </>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="px-3 py-2.5 rounded-[--radius] text-sm bg-[hsl(var(--destructive)/0.10)] border border-[hsl(var(--destructive)/0.35)] text-[hsl(var(--destructive))] flex justify-between gap-2 items-center"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={load}
              className="overline px-2.5 py-1 rounded-full border border-[hsl(var(--destructive)/0.40)] bg-transparent text-[hsl(var(--destructive))] cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && comments.length === 0 && (
          <p className="m-0 py-4 text-foreground/55 italic" style={{ fontSize: 14 }}>
            No letters yet — be the first to share your two cents.
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
          100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </section>
  );
}
