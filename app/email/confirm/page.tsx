// app/email/confirm/page.tsx
//
// Landing page for the link in the confirmation email. Verifies the signed
// token against the address currently on file, then shows a confirm button (a
// plain form POST to /api/email/confirm, so link scanners that only GET never
// verify anything). `?done=1` shows the result after the POST redirect.
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/app/lib/db";
import { verifyConfirm } from "@/app/lib/reengage/unsub-sig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm email",
  robots: { index: false, follow: false },
};

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; t?: string; done?: string }>;
}) {
  const { m, t: token, done } = await searchParams;
  const t = await getTranslations("reengage.confirmPage");
  const row = m
    ? await prisma.memberProfileExtras.findUnique({ where: { memberId: m }, select: { email: true } }).catch(() => null)
    : null;
  const valid = !!row?.email && verifyConfirm(m, row.email, token);

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
            <form method="post" action={`/api/email/confirm?m=${encodeURIComponent(m!)}&t=${encodeURIComponent(token!)}`}>
              <button type="submit" className="btn-pill" style={{ background: "hsl(var(--ink))", color: "hsl(var(--cream))" }}>
                {t("button")}
              </button>
            </form>
          </>
        )}
        <Link href="/" className="underline self-start">
          PizzaDAO
        </Link>
      </div>
    </main>
  );
}
