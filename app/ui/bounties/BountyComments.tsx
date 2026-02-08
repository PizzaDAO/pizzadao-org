"use client";

import React, { useState, useEffect } from "react";
import { UserLink } from "../UserLink";

type Comment = {
  id: number;
  bountyId: number;
  authorId: string;
  content: string;
  createdAt: string;
};

type BountyCommentsProps = {
  bountyId: number;
  currentUserId: string;
  canComment: boolean; // true if user is creator or claimer
};

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function BountyComments({ bountyId, currentUserId, canComment }: BountyCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/bounties/${bountyId}/comments`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch comments");
      setComments(data.comments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, [bountyId]);

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setPosting(true);
    setPostError(null);

    try {
      const res = await fetch(`/api/bounties/${bountyId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newComment.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post comment");

      setNewComment("");
      fetchComments();
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (deletingId) return; // Already deleting
    setDeletingId(commentId);

    try {
      const res = await fetch(`/api/bounties/${bountyId}/comments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete comment");

      // Remove the comment from the local state
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Failed to delete comment");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "8px 0" }}>
        <div style={{ height: 20, background: "rgba(0,0,0,0.04)", borderRadius: 4 }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 8, background: "rgba(255,0,0,0.05)", borderRadius: 4, color: "#c00", fontSize: 11 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      {/* Comments list */}
      {comments.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginBottom: canComment ? 10 : 0 }}>
          {comments.map((comment) => (
            <div
              key={comment.id}
              style={{
                padding: "8px 10px",
                background: comment.authorId === currentUserId ? "rgba(139,92,246,0.05)" : "rgba(0,0,0,0.02)",
                borderRadius: 8,
                borderLeft: `3px solid ${comment.authorId === currentUserId ? "#8b5cf6" : "#e5e7eb"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <UserLink discordId={comment.authorId} style={{ fontSize: 12 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>{timeAgo(comment.createdAt)}</span>
                  {comment.authorId === currentUserId && (
                    <button
                      onClick={() => handleDeleteComment(comment.id)}
                      disabled={deletingId === comment.id}
                      title="Delete comment"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: deletingId === comment.id ? "not-allowed" : "pointer",
                        padding: "0 2px",
                        fontSize: 12,
                        color: deletingId === comment.id ? "#d1d5db" : "#9ca3af",
                        lineHeight: 1,
                        opacity: deletingId === comment.id ? 0.5 : 1,
                        transition: "color 0.15s",
                      }}
                      onMouseEnter={(e) => { if (deletingId !== comment.id) (e.target as HTMLElement).style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { if (deletingId !== comment.id) (e.target as HTMLElement).style.color = "#9ca3af"; }}
                    >
                      {deletingId === comment.id ? "\u2026" : "\u2715"}
                    </button>
                  )}
                </div>
              </div>
              <p style={{ fontSize: 13, margin: 0, lineHeight: 1.4, color: "#374151" }}>
                {comment.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {comments.length === 0 && !canComment && (
        <p style={{ fontSize: 12, color: "#9ca3af", margin: 0, textAlign: "center", padding: "4px 0" }}>
          No updates yet
        </p>
      )}

      {/* Comment input form */}
      {canComment && (
        <form onSubmit={handlePostComment} style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Post an update..."
            disabled={posting}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid rgba(0,0,0,0.15)",
              fontSize: 12,
              outline: "none",
              boxSizing: "border-box" as const,
            }}
          />
          <button
            type="submit"
            disabled={posting || !newComment.trim()}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              background: posting || !newComment.trim() ? "#d1d5db" : "#8b5cf6",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: posting || !newComment.trim() ? "not-allowed" : "pointer",
              whiteSpace: "nowrap" as const,
            }}
          >
            {posting ? "..." : "Send"}
          </button>
        </form>
      )}

      {postError && (
        <div style={{ marginTop: 6, padding: 6, background: "rgba(255,0,0,0.05)", borderRadius: 4, color: "#c00", fontSize: 11 }}>
          {postError}
        </div>
      )}
    </div>
  );
}
