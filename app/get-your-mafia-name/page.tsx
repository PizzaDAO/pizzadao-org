// app/get-your-mafia-name/page.tsx
//
// Public, no-login mafia name generator (plans/mafia-name-port.md, Phase 3):
// topping -> film -> /api/namegen -> pick a name -> certificate + AI portrait,
// ending in a "Join the family" link into /join. Replaces the Lovable page on
// pizzadao.org once infi1trate redirects it here.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MafiaNameFlow } from "@/app/ui/mafia-name/MafiaNameFlow";

const PATH = "/get-your-mafia-name";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mafiaPublic");
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: { canonical: PATH },
    openGraph: { type: "website", siteName: "PizzaDAO", title, description, url: PATH },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function GetYourMafiaNamePage() {
  const t = await getTranslations("mafiaPublic");
  return (
    <main className="bg-background text-foreground min-h-screen">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh]"
        style={{
          background: "radial-gradient(60% 60% at 50% 0%, hsl(var(--tomato) / 0.10), transparent 70%)",
        }}
      />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-12 sm:px-6 sm:pt-20 lg:px-8">
        <p className="overline m-0 mb-6 text-foreground/60">{t("overline")}</p>
        <MafiaNameFlow />
        <p className="ui mt-16 text-center text-[13px] text-foreground/60">{t("footnote")}</p>
      </div>
    </main>
  );
}
