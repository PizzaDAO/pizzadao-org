"use client";

// napoletana-41544 — Editorial restyle of /articles/new.
// Reframes the create flow as "filing a new piece" — overline, display
// headline, handwritten margin note. Submission flow + auth gating
// unchanged.

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
        router.push(`/articles/${created.slug}`);
      } else {
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
        <p className="overline text-foreground/55">Checking your press pass…</p>
      </div>
    );
  }

  if (authStatus === "anon") {
    return (
      <div className="min-h-screen bg-background text-foreground px-5 py-14">
        <div className="mx-auto max-w-[600px] text-center fade-up">
          <p className="overline text-tomato">Press pass required</p>
          <h1
            className="font-display font-black tracking-tight text-foreground mt-3"
            style={{ fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1.02, textWrap: "balance" }}
          >
            Sign in to file your piece
          </h1>
          <p className="mt-3 text-foreground/65">
            You need to sign in with Discord to write articles.
          </p>
          <Link
            href="/"
            className="btn-pill-lg mt-6"
            style={{
              background: "hsl(var(--tomato))",
              color: "hsl(var(--cream))",
              boxShadow: "var(--shadow-soft)",
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
      <div className="min-h-screen bg-background text-foreground px-5 py-14">
        <div className="mx-auto max-w-[600px] text-center fade-up">
          <p className="overline text-tomato">Editor's note</p>
          <h1
            className="font-display font-black tracking-tight text-foreground mt-3"
            style={{ fontSize: "clamp(2rem, 5vw, 3rem)", lineHeight: 1.02, textWrap: "balance" }}
          >
            Not on the staff yet
          </h1>
          <p className="mt-3 text-foreground/65">
            You do not have the required Discord role to author articles.
          </p>
          <Link
            href="/articles"
            className="btn-pill-lg mt-6"
            style={{
              background: "hsl(var(--tomato))",
              color: "hsl(var(--cream))",
              boxShadow: "var(--shadow-soft)",
            }}
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
          className="overline inline-flex min-h-11 items-center text-foreground/55 hover:text-tomato transition-colors no-underline"
        >
          <span aria-hidden className="mr-2">←</span> Cancel
        </Link>
        <div className="relative mt-3 mb-7 fade-up">
          <p className="overline text-tomato">
            <span aria-hidden>§</span>
            <span aria-hidden className="mx-2 opacity-50">···</span>
            New filing
          </p>
          <h1
            className="font-display font-black tracking-[-0.015em] text-foreground mt-3 leading-[1]"
            style={{
              fontSize: "clamp(2.2rem, 5.5vw, 3.6rem)",
              textWrap: "balance",
            }}
          >
            Write a new <span className="text-tomato underline-scribble">dispatch</span>
          </h1>
          <span
            aria-hidden
            className="handwritten mt-2 inline-block rotate-[-3deg] text-foreground/55"
            style={{ fontSize: 14 }}
          >
            print this on the morning edition
          </span>
        </div>

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
