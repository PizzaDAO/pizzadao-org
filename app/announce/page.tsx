"use client";

import { useState } from "react";
import { useSession } from "@/app/lib/hooks/use-session";
import { ANNOUNCE_ALLOWED_DISCORD_IDS } from "@/app/ui/constants";

export default function AnnouncePage() {
  const { data: session, isLoading } = useSession();

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

  if (isLoading) {
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

  // Logged in but not allowlisted (UI convenience; the route re-checks).
  const allowed = ANNOUNCE_ALLOWED_DISCORD_IDS.includes(session.discordId);
  if (!allowed) {
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
            This fires the full PizzaDAO Crew announcement. When you click, it will:
          </p>
          <ul className="list-disc list-inside text-sm text-gray-600 mb-6 space-y-1">
            <li>Post to Discord #general, #band, and #crew</li>
            <li>Start the Discord event</li>
            <li>Post the tweet</li>
            <li>Take attendance</li>
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
