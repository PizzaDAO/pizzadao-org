// app/lib/sync-roles-on-login.ts
// Fire-and-forget role sync that runs after login.
// Calls the role-sync library directly (no internal HTTP round-trip) to pull
// the user's Discord roles into their already-linked Google Sheet row.
import { syncDiscordRolesToSheet } from "./discord-sheet-sync";

/**
 * Trigger a role sync for the given (already authenticated) user. Errors are
 * caught and logged so they never block the login flow.
 *
 * The target sheet row is resolved from the sheet by `discordId` only; this
 * function never links a Discord account to a new row.
 *
 * @param discordId - The authenticated user's Discord ID
 * @param name      - Display name fallback if the row has no Name (optional)
 */
export async function syncRolesOnLogin(discordId: string, name?: string): Promise<void> {
  try {
    await syncDiscordRolesToSheet(discordId, name);
  } catch (err) {
    // Intentionally swallowed - role sync must never break login
    console.error("[syncRolesOnLogin] failed (non-blocking):", err);
  }
}
