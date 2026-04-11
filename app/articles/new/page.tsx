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

      router.push(`/articles/${created.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  if (authStatus === "checking") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-page-bg)", padding: 60, textAlign: "center" }}>
        <p style={{ color: "var(--color-text-secondary, var(--color-text))" }}>Loading...</p>
      </div>
    );
  }

  if (authStatus === "anon") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-page-bg)", padding: "60px 20px" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
          <h1 style={{ color: "var(--color-text-primary, var(--color-text))" }}>Sign in required</h1>
          <p style={{ color: "var(--color-text-secondary, var(--color-text))" }}>
            You need to sign in with Discord to create articles.
          </p>
          <Link
            href="/"
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
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (authStatus === "forbidden") {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-page-bg)", padding: "60px 20px" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
          <h1 style={{ color: "var(--color-text-primary, var(--color-text))" }}>Not authorized</h1>
          <p style={{ color: "var(--color-text-secondary, var(--color-text))" }}>
            You do not have the required Discord role to author articles.
          </p>
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
          href="/articles"
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
        <h1
          style={{
            margin: "8px 0 20px 0",
            fontSize: 28,
            fontWeight: 800,
            color: "var(--color-text-primary, var(--color-text))",
          }}
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
