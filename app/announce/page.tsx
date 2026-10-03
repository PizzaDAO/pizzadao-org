"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/app/lib/hooks/use-session";
import type { BotCheck } from "@/app/lib/announce/bot-check";

function BotCheckStatus({ check }: { check?: BotCheck }) {
  if (!check) return null;
  if ("via" in check && check.via === "webhook") {
    return (
      <p className="text-sm text-green-700 mb-4" data-testid="announce-bot-check">
        ✓ Posting via webhook (no bot permission check needed)
      </p>
    );
  }
  if (!("canView" in check)) return null;
  const channel = check.channelName ? `#${check.channelName}` : "the announcement channel";
  if (!check.configured) {
    return (
      <p className="text-sm text-red-700 mb-4" data-testid="announce-bot-check">
        ✗ Discord isn&apos;t configured for announcements. {check.error}
      </p>
    );
  }
  if (check.canView && check.canSend && check.canMentionEveryone) {
    return (
      <p className="text-sm text-green-700 mb-4" data-testid="announce-bot-check">
        ✓ Bot can post in {channel}
      </p>
    );
  }
  const missing = [
    !check.canView && "View Channel",
    !check.canSend && "Send Messages",
    !check.canMentionEveryone && "Mention @everyone",
  ].filter(Boolean);
  return (
    <div className="text-sm text-red-700 mb-4" data-testid="announce-bot-check">
      <p>
        ✗ Bot is missing: {missing.join(", ")} in {channel}. Fix: Server Settings → channel → Permissions.
      </p>
      {check.error && <p className="text-xs text-red-600 mt-1">{check.error}</p>}
      <p className="text-xs text-gray-500 mt-1">You can still try firing; the check may be stale (cached 5 min).</p>
    </div>
  );
}

export default function AnnouncePage() {
  const { data: session, isLoading } = useSession();
  // Access is decided server-side (Discord role check); the page only asks.
  const { data: access, isLoading: accessLoading } = useQuery<{ allowed: boolean; botCheck?: BotCheck }>({
    queryKey: ["announce-access", session?.discordId],
    enabled: Boolean(session?.authenticated),
    queryFn: async () => {
      const res = await fetch("/api/announce");
      if (!res.ok) return { allowed: false };
      return res.json();
    },
    retry: false,
  });

  const [confirming, setConfirming] = useState(false);
  const [firing, setFiring] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fire() {
    setFiring(true);
    setError(null);
    try {
      const res = await fetch("/api/announce", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(
          data.error || `Announcement failed (status ${res.status})`,
        );
      }
      setSuccess(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setFiring(false);
      setConfirming(false);
    }
  }

  if (isLoading || (session?.authenticated && accessLoading)) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  // Logged out.
  if (!session?.authenticated) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-6 rounded-lg shadow max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-3">
            PizzaDAO Crew Announcement
          </h1>
          <p className="text-gray-600 mb-4">
            You must log in with Discord to use this page.
          </p>
          <a
            href="/api/discord/login"
            className="inline-block bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
          >
            Log in with Discord
          </a>
        </div>
      </div>
    );
  }

  // Logged in but without an announce role (the POST route re-checks).
  if (!access?.allowed) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-6 rounded-lg shadow max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-3">
            PizzaDAO Crew Announcement
          </h1>
          <p className="text-red-600">
            You don&apos;t have access to fire announcements.
          </p>
        </div>
      </div>
    );
  }

  // Allowed.
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Fire PizzaDAO Crew Announcement
          </h1>
          <p className="text-gray-600 mb-2">
            This sends the Community Call announcement built from the
            &quot;Sunday&apos;s Specials&quot; (To Do / Redo rows) on the Crew
            sheet. When you click, it will:
          </p>
          <ul className="list-disc list-inside text-sm text-gray-600 mb-6 space-y-1">
            <li>Post to the Discord announcements channel (@everyone)</li>
            <li>Post to Telegram, if configured</li>
            <li>Update Announce? / Last Sent / Last Error on the sheet</li>
          </ul>

          {success ? (
            <div className="rounded bg-green-50 border border-green-200 p-4 text-green-800">
              Announcement fired successfully.
            </div>
          ) : (
            <>
              {error && (
                <div className="rounded bg-red-50 border border-red-200 p-4 text-red-700 mb-4">
                  {error}
                </div>
              )}

              <BotCheckStatus check={access?.botCheck} />

              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  disabled={firing}
                  className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
                >
                  Fire PizzaDAO Crew announcement
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-900">
                    Are you sure? This sends a real multi-channel blast.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={fire}
                      disabled={firing}
                      className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      {firing ? "Firing..." : "Yes, fire it now"}
                    </button>
                    <button
                      onClick={() => setConfirming(false)}
                      disabled={firing}
                      className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
