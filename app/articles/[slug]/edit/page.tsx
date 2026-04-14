"use client";

import { useEffect, useState, useRef, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArticleEditor, type ArticleEditorValue } from "@/app/ui/articles";

interface Article {
  id: number;
  slug: string;
  title: string;
  excerpt?: string | null;
  content: string;
  coverImage?: string | null;
  authorId: string;
  authorName?: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  tags: string[];
}

export default function EditArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/articles/${slug}`);
        if (res.status === 401) {
          if (!cancelled) setLoadError("You need to sign in to edit this article.");
          return;
        }
        if (res.status === 404) {
          if (!cancelled) setLoadError("Article not found");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setLoadError("Failed to load article");
          return;
        }
        const data = await res.json();
        if (!cancelled) setArticle(data.article);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function submitEdit(value: ArticleEditorValue, publish: boolean) {
    if (!article) return;
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    // Clear any pending success timeout
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }

    try {
      const patchRes = await fetch(`/api/articles/${article.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: value.title,
          content: value.content,
          excerpt: value.excerpt || null,
          coverImage: value.coverImage || null,
          tags: value.tags,
          ...(publish ? { status: "PUBLISHED" } : {}),
        }),
      });

      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save article");
      }

      const data = await patchRes.json();
      const updated = data.article;

      // Update local article state with server response
      setArticle(updated);

      // Show success toast
      setSuccessMessage(publish ? "Article published!" : "Changes saved.");
      successTimeoutRef.current = setTimeout(() => {
        setSuccessMessage(null);
        successTimeoutRef.current = null;
      }, 3000);

      // If slug changed (draft title change), update URL without navigation
      if (updated.slug !== article.slug) {
        router.replace(`/articles/${updated.slug}/edit`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive() {
    if (!article) return;
    if (!confirm("Archive this article? It will no longer be publicly visible.")) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${article.slug}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to archive");
      }
      router.push("/articles");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-page-bg)", padding: 60, textAlign: "center" }}>
        <p style={{ color: "var(--color-text-secondary, var(--color-text))" }}>Loading...</p>
      </div>
    );
  }

  if (loadError || !article) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-page-bg)", padding: "60px 20px" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
          <h1 style={{ color: "var(--color-text-primary, var(--color-text))" }}>{loadError || "Not found"}</h1>
          <Link
            href="/articles"
            style={{
              display: "inline-block",
              marginTop: 16,
              padding: "10px 18px",
              borderRadius: 8,
              background: "var(--color-btn-primary-bg)",
              color: "var(--color-btn-primary-text)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Back to articles
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-page-bg)",
        padding: "40px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Link
          href={`/articles/${article.slug}`}
          style={{
            fontSize: 14,
            color: "var(--color-text-secondary, var(--color-text))",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
          }}
        >
          ← Cancel
        </Link>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            margin: "8px 0 20px 0",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              color: "var(--color-text-primary, var(--color-text))",
            }}
          >
            Edit article
          </h1>
          <button
            type="button"
            onClick={handleArchive}
            disabled={submitting}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid rgba(239, 68, 68, 0.4)",
              background: "transparent",
              color: "#ef4444",
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Archive
          </button>
        </div>

        {successMessage && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(34, 197, 94, 0.1)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              color: "#15803d",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {successMessage}
          </div>
        )}

        <ArticleEditor
          initialValue={{
            title: article.title,
            excerpt: article.excerpt || "",
            content: article.content,
            coverImage: article.coverImage || "",
            tags: article.tags || [],
          }}
          onSaveDraft={(v) => submitEdit(v, false)}
          onPublish={(v) => submitEdit(v, true)}
          onCancel={() => router.push(`/articles/${article.slug}`)}
          submitting={submitting}
          error={error}
          mode="edit"
          status={article.status}
        />
      </div>
    </div>
  );
}
