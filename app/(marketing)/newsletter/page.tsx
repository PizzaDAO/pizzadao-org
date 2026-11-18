import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import Footer, { NewsletterSignup } from "@/app/(marketing)/_site/components/Footer";
import PageHero from "@/app/(marketing)/_site/components/PageHero";
import { pageMeta } from "@/app/(marketing)/_site/meta";

// Prerendered and served from the CDN: force-static empties cookies()/headers() for the whole render, so
// nothing personal can be cached. Per page, never on the layout (newsletter pages need searchParams).
export const dynamic = "force-static";

export const metadata = pageMeta({
  path: "/newsletter",
  title: "Newsletter",
  description: "The PizzaDAO newsletter: what the crews shipped, where the pizza parties are, and how to get involved.",
});

export default function Page() {
  return (
    <main className="min-h-screen bg-cream text-ink">
      <SiteNav solid />
      <PageHero
        section="§ Newsletter"
        title="Stay in the"
        italic="loop."
        lede="What the crews shipped, where the pizza parties are, and how to get involved. We send it when there is something worth saying, and you can unsubscribe from any issue."
      />
      <section className="container pb-16 md:pb-24">
        <div className="rounded-2xl bg-ink px-6 py-8 text-cream md:px-10 md:py-10">
          <NewsletterSignup source="newsletter_page" idPrefix="page" className="max-w-md" />
        </div>
      </section>
      <Footer />
    </main>
  );
}
