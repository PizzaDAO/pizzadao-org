"use client";

import { useState, useEffect } from "react";
import ArticleRenderer from "./ArticleRenderer";
import TagBadge from "./TagBadge";

export interface ArticleEditorValue {
  title: string;
  excerpt: string;
  content: string;
  coverImage: string;
  tags: string[];
}

interface ArticleEditorProps {
  initialValue?: Partial<ArticleEditorValue>;
  onSaveDraft: (value: ArticleEditorValue) => Promise<void> | void;
  onPublish?: (value: ArticleEditorValue) => Promise<void> | void;
  onCancel?: () => void;
  submitting?: boolean;
  error?: string | null;
  mode?: "create" | "edit";
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  canPublish?: boolean;
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  outline: "none",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  boxSizing: "border-box" as const,
};

const labelStyle = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
  color: "var(--color-text-primary, var(--color-text))",
};

export default function ArticleEditor({
  initialValue,
  onSaveDraft,
  onPublish,
  onCancel,
  submitting = false,
  error,
  mode = "create",
  status = "DRAFT",
  canPublish = true,
}: ArticleEditorProps) {
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [excerpt, setExcerpt] = useState(initialValue?.excerpt ?? "");
  const [content, setContent] = useState(initialValue?.content ?? "");
  const [coverImage, setCoverImage] = useState(initialValue?.coverImage ?? "");
  const [tags, setTags] = useState<string[]>(initialValue?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  // When parent-supplied initial value changes (e.g., edit page loads article), refresh state.
  useEffect(() => {
    if (initialValue) {
      setTitle(initialValue.title ?? "");
      setExcerpt(initialValue.excerpt ?? "");
      setContent(initialValue.content ?? "");
      setCoverImage(initialValue.coverImage ?? "");
      setTags(initialValue.tags ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue?.title, initialValue?.content, initialValue?.excerpt, initialValue?.coverImage, initialValue?.tags?.join(",")]);

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    if (tags.length >= 10) return;
    setTags([...tags, t]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  function currentValue(): ArticleEditorValue {
    return { title, excerpt, content, coverImage, tags };
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && (
        <div
          style={{
            padding: 12,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#c00",
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      <div>
        <label style={labelStyle}>Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A great article title"
          style={inputStyle}
          maxLength={200}
        />
      </div>

      <div>
        <label style={labelStyle}>Excerpt (optional, shown on list page)</label>
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="A brief 1-2 sentence summary"
          style={{ ...inputStyle, minHeight: 60, fontFamily: "inherit", resize: "vertical" }}
          maxLength={500}
        />
        <div style={{ textAlign: "right", fontSize: 11, color: "var(--color-text-secondary, var(--color-text))", opacity: 0.6 }}>
          {excerpt.length}/500
        </div>
      </div>

      <div>
        <label style={labelStyle}>Cover image URL (optional)</label>
        <input
          type="url"
          value={coverImage}
          onChange={(e) => setCoverImage(e.target.value)}
          placeholder="https://example.com/image.jpg"
          style={inputStyle}
        />
        {coverImage && (
          <div style={{ marginTop: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImage}
              alt="Cover preview"
              style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, border: "1px solid var(--color-border)" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
      </div>

      <div>
        <label style={labelStyle}>Tags (up to 10)</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="pizza, dao, community..."
            style={{ ...inputStyle, flex: 1 }}
            maxLength={32}
          />
          <button
            type="button"
            onClick={addTag}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid var(--color-border-strong, var(--color-border))",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>
        {tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tags.map((tag) => (
              <span
                key={tag}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <TagBadge tag={tag} size="sm" />
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove ${tag}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-secondary, var(--color-text))",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <label style={labelStyle}>Content (Markdown) *</label>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: showPreview ? "1fr 1fr" : "1fr",
            gap: 16,
          }}
        >
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your article in Markdown..."
            style={{
              ...inputStyle,
              minHeight: 400,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 14,
              resize: "vertical",
            }}
          />
          {showPreview && (
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: 16,
                background: "var(--color-surface)",
                minHeight: 400,
                overflow: "auto",
                maxHeight: 600,
              }}
            >
              {content.trim() ? (
                <ArticleRenderer content={content} />
              ) : (
                <p style={{ color: "var(--color-text-secondary, var(--color-text))", opacity: 0.6, margin: 0 }}>
                  Preview will appear here…
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onSaveDraft(currentValue())}
          disabled={submitting || !title.trim() || !content.trim()}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "1px solid var(--color-border-strong, var(--color-border))",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: 14,
            fontWeight: 600,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Saving..." : mode === "edit" ? "Save changes" : "Save draft"}
        </button>

        {canPublish && onPublish && (
          <button
            type="button"
            onClick={() => onPublish(currentValue())}
            disabled={submitting || !title.trim() || !content.trim()}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid var(--color-btn-primary-border, #22c55e)",
              background: "var(--color-btn-primary-bg, #22c55e)",
              color: "var(--color-btn-primary-text, white)",
              fontSize: 14,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {status === "PUBLISHED" ? "Update published" : "Publish"}
          </button>
        )}

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text)",
              fontSize: 14,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              marginLeft: "auto",
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
