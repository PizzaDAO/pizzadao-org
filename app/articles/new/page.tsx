"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArticleEditor, type ArticleEditorValue } from "@/app/ui/articles";

type AuthStatus = "checking" | "anon" | "forbidden" | "ok";

export default function NewArticlePage() {
  const router = useRouter();
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        const meRes = await fetch("/api/me");
        if (!meRes.ok) {
          setAuthStatus("anon");
          return;
        }
        // Drafts endpoint is role-gated and authenticated, it returns 401 for anon and 403 for missing role
        // We use a probe POST approach via GET /api/articles/drafts which requires auth but not role.
        // To check the author role, we send a minimal probe via a POST that we expect to fail with 400 if authorized
        // but 403 if not. Instead we just let the user try to submit and handle errors.
        setAuthStatus("ok");
      } catch {
        setAuthStatus("anon");
      }
    }
    checkAuth();
  }, []);

  async function submitArticle(value: ArticleEditorValue, publish: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const createRes = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: value.title,
          content: value.content,
          excerpt: value.excerpt || null,
          coverImage: value.coverImage || null,
          tags: value.tags,
        }),
      });

      if (createRes.status === 401) {
        setAuthStatus("anon");
        return;
      }
      if (createRes.status === 403) {
        setAuthStatus("forbidden");
        return;
      }
      if (!createRes.ok) {
        const data = await createRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create article");
      }

      const data = await createRes.json();
      const created = data.article;

      // Optionally publish immediately via PATCH
      if (publish) {
        const patchRes = await fetch(`/api/articles/${created.slug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "PUBLISHED" }),
        });
        if (!patchRes.ok) {
          const data = await patchRes.json().catch(() => ({}));
          throw new Error(data.error || "Article saved but publish failed");
        }
      }

      if (publish) {
        // Published: go to the published article view
        router.push(`/articles/${created.slug}`);
      } else {
        // Draft saved: redirect to edit page to continue editing
        router.push(`/articles/${created.slug}/edit`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (authStatus === "checking") {
    return (
      <div className="min-h-screen bg-background text-foreground py-14 px-5 text-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (authStatus === "anon") {
    return (
      <div className="min-h-screen bg-background text-foreground px-5 py-14">
        <div className="mx-auto max-w-[600px] text-center">
          <h1 className="font-display text-3xl font-bold text-foreground">Sign in required</h1>
          <p className="text-muted-foreground mt-2">
            You need to sign in with Discord to create articles.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 px-5 py-2.5 rounded-[--radius] bg-primary text-primary-foreground font-display font-semibold hover:opacity-90 transition-opacity no-underline"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (authStatus === "forbidden") {
    return (
      <div className="min-h-screen bg-background text-foreground px-5 py-14">
        <div className="mx-auto max-w-[600px] text-center">
          <h1 className="font-display text-3xl font-bold text-foreground">Not authorized</h1>
          <p className="text-muted-foreground mt-2">
            You do not have the required Discord role to author articles.
          </p>
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
          href="/articles"
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground transition-colors no-underline"
        >
          ← Cancel
        </Link>
        <h1
          className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-foreground my-2 mb-5"
          style={{ textWrap: "balance" }}
        >
          New article
        </h1>

        <ArticleEditor
          onSaveDraft={(v) => submitArticle(v, false)}
          onPublish={(v) => submitArticle(v, true)}
          onCancel={() => router.push("/articles")}
          submitting={submitting}
          error={error}
          mode="create"
        />
      </div>
    </div>
  );
}
