"use client";

import { useEffect } from "react";
import Link from "next/link";
import { EditorialNotice } from "@/app/ui/shared/EditorialNotice";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EditorialNotice
      overline="§ Kitchen mishap"
      headline="Something burnt in the oven."
      body={
        <>
          <p className="m-0">
            An unexpected error stopped this page from loading. Give it another go — if it keeps
            happening, tell us via the pencil button in the corner.
          </p>
          {error.digest && (
            <p className="mb-0 mt-3 font-mono text-xs text-foreground/45">ref: {error.digest}</p>
          )}
        </>
      }
    >
      <button
        type="button"
        onClick={() => reset()}
        className="btn-pill border-0"
        style={{ background: "hsl(var(--tomato))", color: "hsl(var(--cream))" }}
      >
        Try again
      </button>
      <Link
        href="/"
        className="btn-pill border no-underline"
        style={{ borderColor: "hsl(var(--rule-warm))", color: "hsl(var(--foreground))" }}
      >
        Go home
      </Link>
    </EditorialNotice>
  );
}
