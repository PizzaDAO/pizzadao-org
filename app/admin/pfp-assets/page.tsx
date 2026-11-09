// app/admin/pfp-assets/page.tsx
//
// PFP asset catalog: upload art, set kind/order, edit unlock rules, activate, grant by member.
// Dread Pizza Roberts only, pinned to the role id (same gate as the mission editor); every
// /api/admin/pfp-assets/* route checks it again.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isDreadPizzaRoberts } from "@/app/lib/mission-review-access";
import { PfpAssetsAdmin } from "./PfpAssetsAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · PFP assets",
  description: "Manage unlockable profile-picture assets.",
  robots: { index: false, follow: false },
};

export default async function AdminPfpAssetsPage() {
  const session = await getSession();
  const allowed = session?.discordId ? await isDreadPizzaRoberts(session.discordId) : false;

  if (!allowed) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
        <div className="text-center">
          <h1 className="text-2xl mb-3">Access Denied</h1>
          <p className="text-foreground/60">
            {session ? "The PFP asset admin is for Dread Pizza Roberts." : "Please log in with Discord."}
          </p>
          {!session && (
            <Link href="/login?returnTo=/admin/pfp-assets" className="inline-block mt-4 underline">
              Log in
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
      <div className="mx-auto max-w-4xl grid gap-5">
        <header className="grid gap-2">
          <p className="overline text-tomato m-0">§ ··· Admin</p>
          <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">PFP assets</h1>
          <p className="m-0 text-foreground/70">
            Backgrounds, frames, accessories and badges members unlock and layer onto their profile picture. An asset is
            unlocked when any of its rules match. New assets start inactive.
          </p>
        </header>
        <PfpAssetsAdmin />
      </div>
    </main>
  );
}
