import Link from "next/link";
import { getSession } from "@/app/lib/session";
import { hasAnyRole } from "@/app/lib/discord";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";
import RosterAuditClient from "./RosterAuditClient";

export const dynamic = "force-dynamic";

// Server-side admin gate: the client UI (and its bundle's API calls) is only
// rendered for Discord admins. The API route enforces the same check.
export default async function RosterAuditPage() {
  const session = await getSession();
  const isAdmin = session?.discordId
    ? await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
    : false;

  if (!isAdmin) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--color-page-bg)",
          color: "var(--color-text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 24, marginBottom: 12 }}>Access Denied</h1>
          <p style={{ opacity: 0.6 }}>
            {session ? "This page is restricted to admins." : "Please log in with Discord."}
          </p>
          <Link href="/" style={{ color: "var(--color-text-primary)", marginTop: 16, display: "inline-block" }}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <RosterAuditClient />;
}
