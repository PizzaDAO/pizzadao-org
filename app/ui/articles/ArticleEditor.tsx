"use client";

import { useState, useEffect, useRef } from "react";
import ArticleRenderer from "./ArticleRenderer";
import TagBadge from "./TagBadge";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const ACCEPT_ATTR = "image/png,image/jpeg,image/webp,image/gif";

async function uploadImage(
  file: File
): Promise<{ url: string; filename: string }> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("Unsupported file type. Use PNG, JPEG, WebP, or GIF.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("File too large. Max 5 MB.");
  }
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/articles/upload", {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Upload failed");
  }
  return res.json();
}

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
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [uploading, setUploading] = useState<"content" | "cover" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

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

  function insertAtCursor(ta: HTMLTextAreaElement, text: string) {
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? content.length;
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  async function handleContentFile(file: File) {
    setUploadError(null);
    setUploading("content");
    try {
      const { url, filename } = await uploadImage(file);
      const alt = filename.replace(/\.[^.]+$/, "");
      const md = `![${alt}](${url})`;
      const ta = contentRef.current;
      if (ta) {
        insertAtCursor(ta, md);
      } else {
        setContent(content + "\n\n" + md);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function handleCoverFile(file: File) {
    setUploadError(null);
    setUploading("cover");
    try {
      const { url } = await uploadImage(file);
      setCoverImage(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  function onContentPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) {
          e.preventDefault();
          handleContentFile(f);
          return;
        }
      }
    }
  }

  function onContentDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.dataTransfer?.files || []);
    const img = files.find((f) => f.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      handleContentFile(img);
    }
  }

  function onContentDragOver(e: React.DragEvent<HTMLTextAreaElement>) {
    if (
      Array.from(e.dataTransfer?.items || []).some((i) => i.kind === "file")
    ) {
      e.preventDefault();
    }
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

      {uploadError && (
        <div
          style={{
            padding: 12,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#c00",
            borderRadius: 8,
            fontSize: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
          role="alert"
        >
          <span>Image upload failed: {uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            aria-label="Dismiss upload error"
            style={{
              background: "transparent",
              border: "none",
              color: "#c00",
              cursor: "pointer",
              fontSize: 18,
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
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
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="url"
            value={coverImage}
            onChange={(e) => setCoverImage(e.target.value)}
            placeholder="https://example.com/image.jpg"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={uploading === "cover"}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid var(--color-border-strong, var(--color-border))",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              fontSize: 14,
              fontWeight: 600,
              cursor: uploading === "cover" ? "not-allowed" : "pointer",
              opacity: uploading === "cover" ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {uploading === "cover" ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={coverInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCoverFile(f);
              e.target.value = "";
            }}
          />
        </div>
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
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={uploading === "content"}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                cursor: uploading === "content" ? "not-allowed" : "pointer",
                opacity: uploading === "content" ? 0.6 : 1,
                fontWeight: 600,
              }}
            >
              {uploading === "content" ? "Uploading…" : "Insert image"}
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleContentFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => setShowCheatSheet(!showCheatSheet)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                background: showCheatSheet ? "var(--color-text)" : "var(--color-surface)",
                color: showCheatSheet ? "var(--color-surface)" : "var(--color-text)",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Markdown help
            </button>
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
        </div>
        {showCheatSheet && (
          <div
            style={{
              marginBottom: 8,
              padding: 12,
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              background: "var(--color-surface)",
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px 24px",
              color: "var(--color-text)",
            }}
          >
            <div><strong style={{ fontFamily: "inherit" }}># Heading 1</strong></div>
            <div><strong style={{ fontFamily: "inherit" }}>## Heading 2</strong></div>
            <div>**bold** &rarr; <strong>bold</strong></div>
            <div>*italic* &rarr; <em>italic</em></div>
            <div>~~strikethrough~~ &rarr; <s>strikethrough</s></div>
            <div>[link text](url) &rarr; link</div>
            <div>![alt](url) &rarr; image</div>
            <div>&gt; blockquote</div>
            <div>- bullet list</div>
            <div>1. numbered list</div>
            <div>`inline code`</div>
            <div>```language &hellip; ``` &rarr; code block</div>
            <div>--- &rarr; horizontal rule</div>
            <div>| col | col | &rarr; table</div>
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: showPreview ? "1fr 1fr" : "1fr",
            gap: 16,
          }}
        >
          <textarea
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onPaste={onContentPaste}
            onDrop={onContentDrop}
            onDragOver={onContentDragOver}
            placeholder="Write your article in Markdown... (paste or drop images to upload!)"
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
