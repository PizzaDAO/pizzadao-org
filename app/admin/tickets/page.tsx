// app/admin/tickets/page.tsx
//
// Pizza Party Ticket lock list: which Unlock locks count, discovery, add by address.
// Dread Pizza Roberts only (same gate as the PFP asset admin); /api/admin/unlock-tickets checks it again.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { TicketsAdmin } from "./TicketsAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · Pizza tickets",
  description: "Manage which Unlock locks count as Pizza Party Tickets.",
  robots: { index: false, follow: false },
};

export default async function AdminTicketsPage() {
  const session = await getSession();
  const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

  if (!allowed) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
        <div className="text-center">
          <h1 className="text-2xl mb-3">Access Denied</h1>
          <p className="text-foreground/60">
            {session ? "The ticket admin is for Dread Pizza Roberts." : "Please log in with Discord."}
          </p>
          {!session && (
            <Link href="/login?returnTo=/admin/tickets" className="inline-block mt-4 underline">
              Log in
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
      <div className="mx-auto max-w-5xl grid gap-5">
        <header className="grid gap-2">
          <p className="overline text-tomato m-0">§ ··· Admin</p>
          <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Pizza tickets</h1>
          <p className="m-0 text-foreground/70">
            A Pizza Party Ticket is a key on any enabled lock below. Discovery adds every pizza-named lock it finds
            (terms are in{" "}
            <Link href="/admin/settings" className="underline">
              settings
            </Link>
            ); disable any that should not count. Keys are rescanned nightly and when a profile is viewed.
          </p>
        </header>
        <TicketsAdmin />
      </div>
    </main>
  );
}
