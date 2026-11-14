// Landing page for the newsletter's visible unsubscribe link. Verifies the signed link, then shows a
// button (a plain form POST to /api/public/newsletter/unsubscribe, so link scanners that only GET
// never unsubscribe anyone). ?done=1 shows the confirmation after the redirect.
import Link from "next/link";
import type { Metadata } from "next";
import { verifyNewsletterUnsub } from "@/app/lib/newsletter/sig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe from the newsletter",
  robots: { index: false, follow: false },
};

export default async function UnsubscribeNewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; sig?: string; done?: string }>;
}) {
  const { s, sig, done } = await searchParams;
  const valid = verifyNewsletterUnsub(s, sig);

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ maxWidth: 440, width: "100%", display: "grid", gap: 16, padding: 28, borderRadius: 28, background: "#fff", border: "1px solid rgba(0,0,0,0.12)", color: "#1d1a16" }}>
        {!valid ? (
          <p style={{ margin: 0 }}>This unsubscribe link is invalid.</p>
        ) : done === "1" ? (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>You&apos;re unsubscribed</h1>
            <p style={{ margin: 0 }}>You won&apos;t get the PizzaDAO newsletter any more.</p>
          </>
        ) : (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>Unsubscribe</h1>
            <p style={{ margin: 0 }}>Press the button to stop getting the PizzaDAO newsletter.</p>
            <form method="post" action={`/api/public/newsletter/unsubscribe?s=${encodeURIComponent(s!)}&sig=${encodeURIComponent(sig!)}`}>
              <button type="submit" style={{ padding: "12px 22px", borderRadius: 999, background: "#1d1a16", color: "#fff", fontWeight: 700, border: 0, cursor: "pointer" }}>
                Unsubscribe
              </button>
            </form>
          </>
        )}
        <Link href="/" style={{ textDecoration: "underline" }}>
          Back to PizzaDAO
        </Link>
      </div>
    </main>
  );
}
