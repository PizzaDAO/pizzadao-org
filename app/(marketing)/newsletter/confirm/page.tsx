// Landing page for the link in the newsletter confirmation email. Verifies the signed token against
// the address on file, then shows a button (a plain form POST to /api/public/newsletter/confirm, so
// link scanners that only GET never subscribe anyone). ?done=1 shows the result after the redirect.
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/app/lib/db";
import { confirmIssuedAt, verifyNewsletterConfirm } from "@/app/lib/newsletter/sig";
import { canConfirm } from "@/app/lib/newsletter/consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm newsletter signup",
  robots: { index: false, follow: false },
};

export default async function ConfirmNewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; t?: string; done?: string }>;
}) {
  const { s, t, done } = await searchParams;
  const row = s
    ? await prisma.newsletterSubscriber
        .findUnique({ where: { id: s }, select: { email: true, status: true, confirmedAt: true, unsubscribedAt: true } })
        .catch(() => null)
    : null;
  const verified = row ? verifyNewsletterConfirm(s, row.email, t) : null;
  const valid = !!row && !!verified && canConfirm(row, confirmIssuedAt(verified.exp));

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ maxWidth: 440, width: "100%", display: "grid", gap: 16, padding: 28, borderRadius: 28, background: "#fff", border: "1px solid rgba(0,0,0,0.12)", color: "#1d1a16" }}>
        {!valid ? (
          <p style={{ margin: 0 }}>This confirmation link is invalid or has expired. You can sign up again from the website.</p>
        ) : done === "1" ? (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>You&apos;re confirmed</h1>
            <p style={{ margin: 0 }}>Thanks. You&apos;ll get the PizzaDAO newsletter. You can unsubscribe from any issue.</p>
          </>
        ) : (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>Confirm your signup</h1>
            <p style={{ margin: 0 }}>Press the button to confirm that you want the PizzaDAO newsletter.</p>
            <form method="post" action={`/api/public/newsletter/confirm?s=${encodeURIComponent(s!)}&t=${encodeURIComponent(t!)}`}>
              <button type="submit" style={{ padding: "12px 22px", borderRadius: 999, background: "#1d1a16", color: "#fff", fontWeight: 700, border: 0, cursor: "pointer" }}>
                Confirm my email
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
