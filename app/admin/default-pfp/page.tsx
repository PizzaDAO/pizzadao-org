// app/admin/default-pfp/page.tsx
//
// Owner-only counts for the dough-ball default PFPs (assigned, pool left, generated this month, spend).
// Dread Pizza Roberts only, pinned to the role id. The switch and limits live in /admin/settings.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { loadDefaultPfpSummary } from "@/app/lib/default-pfp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · Default PFPs",
  description: "Dough-ball default profile pictures: counts and spend.",
  robots: { index: false, follow: false },
};

export default async function AdminDefaultPfpPage() {
  const session = await getSession();
  const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

  if (!allowed) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
        <div className="text-center">
          <h1 className="text-2xl mb-3">Access Denied</h1>
          <p className="text-foreground/60">{session ? "This page is for Dread Pizza Roberts." : "Please log in with Discord."}</p>
          {!session && (
            <Link href="/login?returnTo=/admin/default-pfp" className="inline-block mt-4 underline">
              Log in
            </Link>
          )}
        </div>
      </main>
    );
  }

  let s: Awaited<ReturnType<typeof loadDefaultPfpSummary>> | null = null;
  try {
    s = await loadDefaultPfpSummary();
  } catch {
    s = null;
  }
  const rows: Array<[string, string]> = s
    ? [
        ["Members with their own dough ball", String(s.assigned)],
        ["  from the approved pool", String(s.assignedFromPool)],
        ["  generated on demand", String(s.assignedGenerated)],
        ["Approved images left in the pool", String(s.poolRemaining)],
        ["Images generated this month", String(s.generatedThisMonth)],
        ["Estimated spend this month", `$${(s.spendCentsThisMonth / 100).toFixed(2)} of $${s.budgetUsd}`],
      ]
    : [];

  return (
    <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
      <div className="mx-auto max-w-2xl grid gap-5">
        <header className="grid gap-2">
          <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Default PFPs</h1>
          <p className="m-0 text-foreground/70">
            Members without a picture of their own get a unique dough ball. Switch and limits: search &quot;Dough ball&quot; in{" "}
            <Link href="/admin/settings" className="underline">
              settings
            </Link>
            .
          </p>
        </header>
        {s ? (
          <dl className="grid gap-2 m-0">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-foreground/10 pb-2">
                <dt className="whitespace-pre">{k}</dt>
                <dd className="m-0 font-bold">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-foreground/60">The counts could not be loaded (the migration may not be applied yet).</p>
        )}
      </div>
    </main>
  );
}
