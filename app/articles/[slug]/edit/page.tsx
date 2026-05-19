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
      <div className="min-h-screen bg-background text-foreground py-14 px-5 text-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (loadError || !article) {
    return (
      <div className="min-h-screen bg-background text-foreground px-5 py-14">
        <div className="mx-auto max-w-[600px] text-center">
          <h1 className="font-display text-3xl font-bold text-foreground">{loadError || "Not found"}</h1>
          <Link
            href="/articles"
            className="inline-block mt-4 px-5 py-2.5 rounded-[--radius] bg-primary text-primary-foreground font-display font-semibold hover:opacity-90 transition-opacity no-underline"
          >
            Back to articles
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground px-5 pt-10 pb-20">
      <div className="mx-auto max-w-[1100px]">
        <Link
          href={`/articles/${article.slug}`}
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground transition-colors no-underline"
        >
          ← Cancel
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2 mb-5">
          <h1
            className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-foreground m-0"
            style={{ textWrap: "balance" }}
          >
            Edit article
          </h1>
          <button
            type="button"
            onClick={handleArchive}
            disabled={submitting}
            className="px-3.5 py-2 rounded-[--radius] border border-[hsl(var(--destructive)/0.40)] bg-transparent text-[hsl(var(--destructive))] text-xs font-semibold cursor-pointer hover:bg-[hsl(var(--destructive)/0.10)] disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
          >
            Archive
          </button>
        </div>

        {successMessage && (
          <div
            role="status"
            className="px-4 py-3 mb-4 rounded-[--radius] text-sm font-semibold border bg-[hsl(142_71%_45%/0.10)] border-[hsl(142_71%_45%/0.30)] text-[hsl(142_71%_25%)] dark:text-[hsl(142_71%_60%)]"
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
