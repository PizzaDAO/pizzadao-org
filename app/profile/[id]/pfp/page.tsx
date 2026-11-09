// /profile/[id]/pfp: the PFP composer. Owner only: the session must resolve to this member id.
// The compose API re-checks everything, so this gate is for a clean page, not the security line.

import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { PfpComposer } from "./PfpComposer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit your PFP",
  robots: { index: false, follow: false },
};

export default async function PfpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const memberId = session?.discordId ? await fetchMemberIdByDiscordId(session.discordId).catch(() => null) : null;

  if (!session || !memberId || String(memberId) !== String(id)) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
        <div className="text-center">
          <h1 className="text-2xl mb-3">{session ? "Not your profile" : "Please log in"}</h1>
          <p className="text-foreground/60">
            {session ? "You can only edit your own picture." : "Log in with Discord to edit your picture."}
          </p>
          <Link
            href={session ? `/profile/${id}` : `/login?returnTo=/profile/${id}/pfp`}
            className="inline-block mt-4 underline"
          >
            {session ? "Back to the profile" : "Log in"}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
      <div className="mx-auto max-w-3xl grid gap-5">
        <header className="grid gap-1">
          <Link href={`/profile/${memberId}`} className="text-sm underline">Back to your profile</Link>
          <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Edit your PFP</h1>
          <p className="m-0 text-foreground/70">
            Pick a base, then layer on what you have unlocked. Keep the important bits inside the middle circle:
            Discord crops pictures to a circle.
          </p>
        </header>
        <PfpComposer memberId={String(memberId)} />
      </div>
    </main>
  );
}
