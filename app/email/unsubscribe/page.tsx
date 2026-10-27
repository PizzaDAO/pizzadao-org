// app/email/unsubscribe/page.tsx
//
// Landing page for the footer link in the weekly email. Verifies the signed
// link, then shows a confirm button (a plain form POST to
// /api/email/unsubscribe, so link scanners that only GET never unsubscribe
// anyone). `?done=1` shows the confirmation after the POST redirect.
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { verifyUnsubscribe } from "@/app/lib/reengage/unsub-sig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; s?: string; done?: string }>;
}) {
  const { m, s, done } = await searchParams;
  const t = await getTranslations("reengage.unsub");
  const valid = verifyUnsubscribe(m, s);

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
      <div
        className="paper-soft grid gap-4 rounded-[28px] border p-7 max-w-md w-full"
        style={{
          background: "hsl(var(--card))",
          color: "hsl(var(--card-foreground))",
          borderColor: "hsl(var(--rule-warm) / 0.55)",
        }}
      >
        {!valid ? (
          <p className="m-0 text-foreground/70">{t("invalid")}</p>
        ) : done === "1" ? (
          <>
            <h1 className="m-0 text-2xl font-black">{t("doneTitle")}</h1>
            <p className="m-0 text-foreground/70">{t("doneBody")}</p>
          </>
        ) : (
          <>
            <h1 className="m-0 text-2xl font-black">{t("title")}</h1>
            <p className="m-0 text-foreground/70">{t("body")}</p>
            <form method="post" action={`/api/email/unsubscribe?m=${encodeURIComponent(m!)}&s=${encodeURIComponent(s!)}`}>
              <button type="submit" className="btn-pill" style={{ background: "hsl(var(--ink))", color: "hsl(var(--cream))" }}>
                {t("button")}
              </button>
            </form>
          </>
        )}
        <Link href="/" className="underline self-start">
          {t("home")}
        </Link>
      </div>
    </main>
  );
}
