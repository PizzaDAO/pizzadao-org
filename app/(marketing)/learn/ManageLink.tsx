"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/app/lib/hooks/use-session";

/** "Schedule a session" for leads: the page itself is public and cached, so the check runs in the browser. */
export default function ManageLink() {
  const { data: session } = useSession();
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (!session?.authenticated) return;
    let off = false;
    fetch("/api/learn/next", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { scheduleCrewId?: string | null } | null) => {
        if (!off && j?.scheduleCrewId) setHref(`/crew/${j.scheduleCrewId}/sessions`);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [session?.authenticated]);
  if (!href) return null;
  return (
    <a href={href} className="mt-5 inline-block rounded-full bg-ink px-5 py-2 text-sm font-semibold text-cream">
      Manage sessions
    </a>
  );
}
