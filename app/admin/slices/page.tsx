// Admin: Call Slices console (crew template art, queue status, retry). Guild admins only (the API enforces it too).
import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import AdminSlicesClient from "./AdminSlicesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Call Slices admin", robots: { index: false, follow: false } };

export default async function AdminSlicesPage() {
  const session = await getSession();
  const allowed = session?.discordId ? await isAdminDiscordId(session.discordId) : false;
  if (!allowed) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5 text-center">
        <div>
          <h1 className="text-2xl mb-3">Admins only</h1>
          {!session && <Link href="/login?returnTo=/admin/slices" className="underline">Log in</Link>}
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-background text-foreground p-5 md:p-10">
      <div className="mx-auto max-w-4xl grid gap-4">
        <h1 className="font-[family-name:var(--font-display)] font-black text-3xl m-0">Call Slices</h1>
        <p className="m-0 text-foreground/70">Attendance NFTs on Base. Members claim on /slices; the server mints and pays gas.</p>
        <AdminSlicesClient />
      </div>
    </main>
  );
}
