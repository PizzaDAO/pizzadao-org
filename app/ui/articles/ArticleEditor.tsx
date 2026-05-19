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

// Shared input classes — cream surface, ink-soft border, tomato focus ring.
const inputClass =
  "w-full px-3 py-2.5 text-sm rounded-[--radius] bg-[hsl(var(--cream))] dark:bg-card text-foreground border border-[hsl(var(--rule)/0.22)] outline-none focus:border-[hsl(var(--tomato))] focus:ring-2 focus:ring-[hsl(var(--tomato)/0.30)] transition-colors box-border";

const labelClass = "block text-[13px] font-display font-semibold mb-1.5 text-foreground";

// Small toolbar buttons (insert image, markdown help, preview toggle).
const toolbarBtnClass =
  "px-2.5 py-1 text-xs font-semibold rounded-md border border-[hsl(var(--rule)/0.22)] bg-card text-foreground hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors";

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

  function wrapSelection(ta: HTMLTextAreaElement, before: string, after: string) {
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = content.slice(start, end);
    const next = content.slice(0, start) + before + selected + after + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      if (selected) {
        ta.setSelectionRange(start + before.length, end + before.length);
      } else {
        ta.setSelectionRange(start + before.length, start + before.length);
      }
    });
  }

  function onContentKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const ta = contentRef.current;
    if (!ta) return;

    switch (e.key.toLowerCase()) {
      case "b":
        e.preventDefault();
        wrapSelection(ta, "**", "**");
        break;
      case "i":
        e.preventDefault();
        wrapSelection(ta, "*", "*");
        break;
      case "k":
        e.preventDefault();
        wrapSelection(ta, "[", "](url)");
        break;
      case "e":
        e.preventDefault();
        wrapSelection(ta, "`", "`");
        break;
    }
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
    <div className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="px-3 py-3 rounded-[--radius] text-sm font-semibold border bg-[hsl(var(--destructive)/0.10)] border-[hsl(var(--destructive)/0.30)] text-[hsl(var(--destructive))]"
        >
          {error}
        </div>
      )}

      {uploadError && (
        <div
          role="alert"
          className="px-3 py-3 rounded-[--radius] text-sm font-semibold border bg-[hsl(var(--destructive)/0.10)] border-[hsl(var(--destructive)/0.30)] text-[hsl(var(--destructive))] flex items-center justify-between gap-3"
        >
          <span>Image upload failed: {uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            aria-label="Dismiss upload error"
            className="bg-transparent border-0 text-[hsl(var(--destructive))] cursor-pointer text-lg leading-none p-0"
          >
            ×
          </button>
        </div>
      )}

      <div>
        <label className={labelClass}>Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A great article title"
          className={inputClass}
          maxLength={200}
        />
      </div>

      <div>
        <label className={labelClass}>Excerpt (optional, shown on list page)</label>
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="A brief 1-2 sentence summary"
          className={`${inputClass} min-h-[60px] resize-y`}
          style={{ fontFamily: "inherit" }}
          maxLength={500}
        />
        <div className="text-right text-[11px] text-muted-foreground mt-1">
          {excerpt.length}/500
        </div>
      </div>

      <div>
        <label className={labelClass}>Cover image URL (optional)</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={coverImage}
            onChange={(e) => setCoverImage(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={uploading === "cover"}
            className="px-4 py-2.5 rounded-[--radius] border border-[hsl(var(--rule)/0.22)] bg-secondary text-secondary-foreground text-sm font-semibold cursor-pointer hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
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
          <div className="mt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImage}
              alt="Cover preview"
              className="max-w-full max-h-[200px] rounded-[--radius] border border-[hsl(var(--rule)/0.22)]"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>Tags (up to 10)</label>
        <div className="flex gap-2 mb-2">
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
            className={`${inputClass} flex-1`}
            maxLength={32}
          />
          <button
            type="button"
            onClick={addTag}
            className="px-4 py-2.5 rounded-[--radius] border border-[hsl(var(--rule)/0.22)] bg-secondary text-secondary-foreground text-sm font-semibold cursor-pointer hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] transition-colors"
          >
            Add
          </button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1">
                <TagBadge tag={tag} size="sm" />
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove ${tag}`}
                  className="bg-transparent border-0 text-muted-foreground hover:text-[hsl(var(--tomato))] cursor-pointer text-sm p-0 transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex justify-between items-center mb-1.5">
          <label className={labelClass}>Content (Markdown) *</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={uploading === "content"}
              className={toolbarBtnClass}
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
              className={
                showCheatSheet
                  ? "px-2.5 py-1 text-xs font-semibold rounded-md border border-[hsl(var(--ink))] bg-primary text-primary-foreground cursor-pointer transition-colors"
                  : toolbarBtnClass
              }
            >
              Markdown help
            </button>
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className={toolbarBtnClass}
            >
              {showPreview ? "Hide preview" : "Show preview"}
            </button>
          </div>
        </div>
        {showCheatSheet && (
          <div
            className="mb-2 p-3 rounded-[--radius] border border-[hsl(var(--rule)/0.22)] bg-card text-card-foreground text-[13px] leading-normal"
            style={{
              fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "4px 24px",
            }}
          >
            <div><strong style={{ fontFamily: "inherit" }}># Heading 1</strong></div>
            <div><strong style={{ fontFamily: "inherit" }}>## Heading 2</strong></div>
            <div>**bold** &rarr; <strong>bold</strong> <span className="opacity-50">(Ctrl+B)</span></div>
            <div>*italic* &rarr; <em>italic</em> <span className="opacity-50">(Ctrl+I)</span></div>
            <div>~~strikethrough~~ &rarr; <s>strikethrough</s></div>
            <div>[link text](url) &rarr; link <span className="opacity-50">(Ctrl+K)</span></div>
            <div>![alt](url &quot;caption&quot;) &rarr; image with caption</div>
            <div>&gt; blockquote</div>
            <div>- bullet list</div>
            <div>1. numbered list</div>
            <div>`inline code` <span className="opacity-50">(Ctrl+E)</span></div>
            <div>```language &hellip; ``` &rarr; code block</div>
            <div>--- &rarr; horizontal rule</div>
            <div>| col | col | &rarr; table</div>
          </div>
        )}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: showPreview ? "1fr 1fr" : "1fr" }}
        >
          <textarea
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={onContentKeyDown}
            onPaste={onContentPaste}
            onDrop={onContentDrop}
            onDragOver={onContentDragOver}
            placeholder="Write your article in Markdown… (paste or drop images to upload!)"
            className={`${inputClass} min-h-[400px] resize-y text-sm`}
            style={{
              fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
          />
          {showPreview && (
            <div
              className="rounded-[--radius] border border-[hsl(var(--rule)/0.22)] bg-card p-4 overflow-auto"
              style={{ minHeight: 400, maxHeight: 600 }}
            >
              {content.trim() ? (
                <ArticleRenderer content={content} />
              ) : (
                <p className="text-muted-foreground m-0">
                  Preview will appear here…
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mt-2">
        <button
          type="button"
          onClick={() => onSaveDraft(currentValue())}
          disabled={submitting || !title.trim() || !content.trim()}
          className="px-4 py-2.5 rounded-[--radius] border border-[hsl(var(--primary))] bg-primary text-primary-foreground text-sm font-display font-semibold cursor-pointer hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
        >
          {submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Save draft"}
        </button>

        {canPublish && onPublish && (
          <button
            type="button"
            onClick={() => onPublish(currentValue())}
            disabled={submitting || !title.trim() || !content.trim()}
            className="px-4 py-2.5 rounded-[--radius] border border-[hsl(var(--tomato))] bg-tomato text-cream text-sm font-display font-bold cursor-pointer hover:bg-[hsl(var(--tomato-deep))] hover:border-[hsl(var(--tomato-deep))] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {status === "PUBLISHED" ? "Update published" : "Publish"}
          </button>
        )}

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="ml-auto px-4 py-2.5 rounded-[--radius] border border-[hsl(var(--rule)/0.22)] bg-transparent text-foreground text-sm font-semibold cursor-pointer hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
