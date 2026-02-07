// app/lib/sync-roles-on-login.ts
// Fire-and-forget role sync that runs after Discord OAuth login.
// Calls the internal /api/discord/sync-to-sheet endpoint to pull
// the user's Discord roles into the Google Sheet.

/**
 * Trigger a role sync for the given user. This calls our own
 * sync-to-sheet API endpoint internally. Errors are caught and
 * logged so they never block the login flow.
 *
 * @param origin  - The base URL of the app (e.g. "https://pizzadao.org")
 * @param discordId - The user's Discord ID
 * @param memberId  - The user's member ID from the sheet (optional)
 * @param name      - The user's display name (optional)
 */
export async function syncRolesOnLogin(
  origin: string,
  discordId: string,
  memberId?: string,
  name?: string,
): Promise<void> {
  try {
    const res = await fetch(`${origin}/api/discord/sync-to-sheet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discordId,
        memberId: memberId ?? undefined,
        mafiaName: name ?? undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[syncRolesOnLogin] sync-to-sheet returned ${res.status}: ${body}`);
    }
  } catch (err) {
    // Intentionally swallowed - role sync must never break login
    console.error("[syncRolesOnLogin] failed (non-blocking):", err);
  }
}
