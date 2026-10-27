// Admin: paste POAP mint-link pools per call. Guild admins only (the API enforces it too).
import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import AdminPoapsClient from "./AdminPoapsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "POAP links", robots: { index: false, follow: false } };

export default async function AdminPoapsPage() {
  const session = await getSession();
  const allowed = session?.discordId ? await isAdminDiscordId(session.discordId) : false;
  if (!allowed) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5 text-center">
        <div>
          <h1 className="text-2xl mb-3">Admins only</h1>
          {!session && <Link href="/login?returnTo=/admin/poaps" className="underline">Log in</Link>}
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
      <div className="mx-auto max-w-3xl grid gap-4">
        <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">POAP claim links</h1>
        <p className="m-0 text-foreground/70">Members who attended a call claim one unused link on /poaps.</p>
        <AdminPoapsClient />
      </div>
    </main>
  );
}
