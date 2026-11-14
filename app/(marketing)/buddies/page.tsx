// Public Top buddies page: the ten buddies with the most trainees who finished. Answers 404 until
// buddy.publicRecognitionEnabled (and buddy.enabled) is on. Only completed pairs count and members who
// opted out are left out (see app/lib/buddy/recognition.ts); only a name, a profile link and a count leave the database.
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import Footer from "@/app/(marketing)/_site/components/Footer";
import { pageMeta } from "@/app/(marketing)/_site/meta";
import { getTopBuddies } from "@/app/lib/buddy/recognition";

export const runtime = "nodejs";
// Rendered per request: a build without a database must not bake in a 404.
export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  path: "/buddies",
  title: "Top buddies",
  description: "The PizzaDAO buddies who have helped the most new members get going.",
});

export default async function BuddiesPage() {
  const top = await getTopBuddies().catch(() => null);
  if (!top) notFound();
  return (
    <main className="min-h-screen bg-cream text-ink">
      <SiteNav solid />
      <section className="container pt-28 pb-16 md:pt-36">
        <div className="mx-auto max-w-[820px]">
          <p className="ui text-xs uppercase tracking-[0.22em] text-ink/60">Community</p>
          <h1 className="font-display mt-2 text-4xl font-extrabold leading-tight md:text-5xl">Top buddies</h1>
          <p className="mt-4 text-lg text-ink/75">
            Members who stayed alongside a new member until they reached level {top.level}. Thank you.
          </p>
          {top.buddies.length === 0 ? (
            <p className="mt-8 text-ink/70">No buddy has seen a trainee through yet. Check back soon.</p>
          ) : (
            <ol className="mt-8 space-y-3">
              {top.buddies.map((b, i) => (
                <li key={b.memberId} className="flex items-center justify-between gap-3 rounded-2xl border border-ink/15 bg-cream/60 p-4">
                  <span className="flex items-center gap-3">
                    <span className="font-display w-8 text-xl font-extrabold text-ink/50">{i + 1}</span>
                    <Link href={`/profile/${b.memberId}`} className="font-semibold underline">
                      {b.name}
                    </Link>
                  </span>
                  <span className="text-sm text-ink/70">
                    {b.helped} {b.helped === 1 ? "trainee" : "trainees"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
      <Footer />
    </main>
  );
}
