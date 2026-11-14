// app/admin/newsletter/[id]/page.tsx
//
// Newsletter issue editor (phase 2). Server-side admin gate; the API routes enforce the same check.
import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { IssueEditor } from "./IssueEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin · Newsletter issue",
  robots: { index: false, follow: false },
};

export default async function AdminNewsletterIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const isAdmin = session?.discordId ? await isAdminDiscordId(session.discordId) : false;
  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-5">
        <div className="text-center">
          <h1 className="text-2xl mb-3">Access Denied</h1>
          <p className="text-foreground/60">{session ? "This page is restricted to admins." : "Please log in with Discord."}</p>
          <Link href="/" className="inline-block mt-4 underline">
            Back
          </Link>
        </div>
      </main>
    );
  }
  const { id } = await params;
  return <IssueEditor id={id} />;
}
