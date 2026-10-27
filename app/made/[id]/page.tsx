// app/made/[id]/page.tsx
//
// Public, read-only certificate for a claimed mafia name (plans/mafia-name-port.md,
// Phase 2). Reached from the "Share on X" link on the finale. The id is an
// unguessable 10-char token; the page shows the mafia name, its origin line,
// topping and portrait only (no Discord id, no real name, no member id).
//
// The share card is the portrait itself when there is one, otherwise the
// generated topping card at /made/[id]/og.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getPublicClaim, type PublicClaim } from "@/app/lib/mafia-claim";
import { originLine } from "@/app/lib/name-origin";
import { toppingImageFor } from "@/app/lib/topping-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function describe(claim: PublicClaim) {
  const t = await getTranslations("onboarding.name");
  return originLine(t, claim.origin ?? undefined, claim.origin?.film);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const claim = await getPublicClaim(id);
  if (!claim) return { title: "Page not found", robots: { index: false, follow: false } };

  const t = await getTranslations("made");
  const title = t("metaTitle", { name: claim.name });
  const description = (await describe(claim)) || t("metaDescription", { name: claim.name });
  const path = `/made/${id}`;
  const image = claim.portraitUrl ?? `${path}/og`;
  const alt = t("portraitAlt", { name: claim.name });

  return {
    title,
    description,
    alternates: { canonical: path },
    // A shared certificate is for people who got the link, not for search.
    robots: { index: false, follow: true },
    openGraph: {
      type: "website",
      siteName: "PizzaDAO",
      title,
      description,
      url: path,
      images: [claim.portraitUrl ? { url: image, alt } : { url: image, width: 1200, height: 630, alt }],
    },
    twitter: {
      // The portrait is square; the generated fallback is 1200x630.
      card: claim.portraitUrl ? "summary" : "summary_large_image",
      title,
      description,
      images: [{ url: image, alt }],
    },
  };
}

export default async function MadePage({ params }: Params) {
  const { id } = await params;
  const claim = await getPublicClaim(id);
  if (!claim) notFound();

  const [t, locale, origin] = await Promise.all([getTranslations("made"), getLocale(), describe(claim)]);
  const toppingImage = claim.topping ? toppingImageFor(claim.topping) : undefined;
  const date = claim.createdAt.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-12 sm:px-6 sm:pt-20">
        <article
          className="paper-soft relative overflow-hidden rounded-[22px] border p-6 sm:p-9"
          style={{
            borderColor: "hsl(var(--rule-warm) / 0.55)",
            background: "hsl(var(--card))",
            boxShadow: "var(--shadow-lifted)",
          }}
        >
          <p className="overline m-0" style={{ color: "hsl(var(--foreground) / 0.6)", letterSpacing: "0.08em" }}>
            {t("record")}
          </p>
          <div className="my-4 h-px" style={{ background: "hsl(var(--foreground) / 0.18)" }} />

          <div className="grid items-center gap-6 sm:grid-cols-[minmax(110px,150px)_1fr]">
            <div
              className="relative mx-auto aspect-square w-full max-w-[150px] overflow-hidden"
              style={{
                borderRadius: "48% 52% 53% 47% / 51% 48% 52% 49%",
                border: "3px solid hsl(var(--tomato) / 0.85)",
                background: "hsl(var(--card))",
                transform: "rotate(-6deg)",
              }}
            >
              {claim.portraitUrl || toppingImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={claim.portraitUrl ?? toppingImage}
                  alt={claim.portraitUrl ? t("portraitAlt", { name: claim.name }) : ""}
                  className="h-full w-full object-cover"
                  style={claim.portraitUrl ? { transform: "rotate(6deg) scale(1.25)" } : undefined}
                />
              ) : null}
            </div>

            <div className="min-w-0">
              <p className="overline m-0" style={{ color: "hsl(var(--tomato-readable))", letterSpacing: "0.08em" }}>
                {t("madeStatus")}
              </p>
              <h1
                className="m-0 mt-2 font-[family-name:var(--font-display)] font-black"
                style={{
                  fontSize: "clamp(1.8rem, 6vw, 3rem)",
                  lineHeight: 0.98,
                  letterSpacing: "-0.015em",
                  textWrap: "balance",
                  overflowWrap: "anywhere",
                }}
              >
                {claim.name}
              </h1>
              {origin && (
                <p className="m-0 mt-3 text-[15px] italic" style={{ color: "hsl(var(--foreground) / 0.75)" }}>
                  {origin}
                </p>
              )}
            </div>
          </div>

          <p className="overline m-0 mt-7 border-t pt-4" style={{ color: "hsl(var(--foreground) / 0.5)", borderColor: "hsl(var(--foreground) / 0.15)" }}>
            {t("filed", { date })}
          </p>
        </article>

        <section className="mt-10 grid justify-items-center gap-3 text-center">
          <h2 className="m-0 font-[family-name:var(--font-display)] text-2xl font-black">{t("ctaHeading")}</h2>
          <p className="m-0 max-w-[40ch] text-foreground/70">{t("ctaBody")}</p>
          <Link
            href="/join"
            className="btn-pill-lg no-underline"
            style={{
              background: "hsl(var(--tomato-deep))",
              color: "hsl(var(--cream))",
              border: "1px solid hsl(var(--tomato))",
            }}
          >
            {t("ctaButton")}
          </Link>
        </section>
      </div>
    </main>
  );
}
