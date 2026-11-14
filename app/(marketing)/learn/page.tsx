// Public sessions page: upcoming and past public education sessions, with add-to-calendar and, when a
// lead linked one, the recording. Answers 404 until education.publicListingEnabled is on. Rendered
// from CrewSession (status SCHEDULED, public, not canceled); nothing else about a session leaves the
// database (see app/lib/education-sessions/public.ts).
import { notFound } from "next/navigation";
import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import Footer from "@/app/(marketing)/_site/components/Footer";
import { pageMeta } from "@/app/(marketing)/_site/meta";
import { formatWhen } from "@/app/lib/education-sessions/build";
import { listPublicSessions, type PublicSession } from "@/app/lib/education-sessions/public";
import { getSetting } from "@/app/lib/settings";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import LocalTime from "./LocalTime";
import ManageLink from "./ManageLink";

export const runtime = "nodejs";
// Rendered per request (a few indexed reads): a build without a database must not bake in a 404.
export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  path: "/learn",
  title: "Sessions",
  description: "Upcoming and past PizzaDAO learning sessions, with add-to-calendar.",
});

const DEFAULT_INTRO = "Talks and workshops from the PizzaDAO community. Everyone is welcome.";

function Card({ s, past }: { s: PublicSession; past: boolean }) {
  return (
    <li id={s.id} className="rounded-2xl border border-ink/15 bg-cream/60 p-5">
      <h3 className="font-display text-xl font-extrabold leading-tight">{s.title}</h3>
      <p className="mt-1 text-sm text-ink/70">
        <LocalTime iso={s.startsAt.toISOString()} fallback={formatWhen(s)} />
        {s.presenter ? ` · ${s.presenter}` : ""}
      </p>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">{s.description}</p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm font-medium">
        {!past && (
          <a className="underline" href={`/api/public/sessions/${s.id}/ics`}>
            Add to calendar
          </a>
        )}
        {!past && s.eventUrl && (
          <a className="underline" href={s.eventUrl} target="_blank" rel="noreferrer">
            Interested on Discord
          </a>
        )}
        {past && s.recordingUrl && (
          <a className="underline" href={s.recordingUrl} target="_blank" rel="noreferrer">
            Watch or listen
          </a>
        )}
      </div>
    </li>
  );
}

export default async function LearnPage() {
  if (!(await toggleEnabled("education.publicListingEnabled").catch(() => false))) notFound();
  const [{ upcoming, past }, intro] = await Promise.all([listPublicSessions(), getSetting("education.publicIntroText").catch(() => "")]);
  return (
    <main className="min-h-screen bg-cream text-ink">
      <SiteNav solid />
      <section className="container pt-28 pb-16 md:pt-36">
        <div className="mx-auto max-w-[820px]">
          <p className="ui text-xs uppercase tracking-[0.22em] text-ink/60">Learn</p>
          <h1 className="font-display mt-2 text-4xl font-extrabold leading-tight md:text-5xl">Sessions</h1>
          <p className="mt-4 text-lg text-ink/75">{intro || DEFAULT_INTRO}</p>
          <ManageLink />

          <h2 className="font-display mt-10 text-2xl font-extrabold">Upcoming</h2>
          {upcoming.length === 0 ? (
            <p className="mt-3 text-ink/70">Nothing is scheduled right now. Check back soon.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {upcoming.map((s) => (
                <Card key={s.id} s={s} past={false} />
              ))}
            </ul>
          )}

          {past.length > 0 && (
            <>
              <h2 className="font-display mt-12 text-2xl font-extrabold">Past sessions</h2>
              <ul className="mt-4 space-y-4">
                {past.map((s) => (
                  <Card key={s.id} s={s} past />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
      <Footer />
    </main>
  );
}
